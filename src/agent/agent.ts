import { IAyaAgent } from '@/agent/iagent'
import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { initializeClients } from '@/clients'
import { getTokenForProvider } from '@/common/config'
import { initializeDatabase } from '@/common/db'
import { AgentcoinRuntime } from '@/common/runtime'
import { Context, ContextHandler, ModelConfig, SdkEventKind } from '@/common/types'
import agentcoinPlugin from '@/plugins/agentcoin'
import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import { EventService } from '@/services/event'
import { IKnowledgeBaseService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { KeychainService } from '@/services/keychain'
import { KnowledgeBaseService } from '@/services/knowledge-base'
import { MemoriesService } from '@/services/memories'
import { ProcessService } from '@/services/process'
import { WalletService } from '@/services/wallet'
import { AGENTCOIN_MESSAGE_HANDLER_TEMPLATE } from '@/templates/message'
import {
  Action,
  CacheManager,
  DbCacheAdapter,
  elizaLogger,
  Evaluator,
  Plugin,
  Provider,
  Service,
  UUID,
  type Character
} from '@elizaos/core'
import { bootstrapPlugin } from '@elizaos/plugin-bootstrap'
import fs from 'fs'
import { PathResolver } from '@/common/path-resolver'
import { isNull } from '@/common/functions'

const reservedAgentDirs = new Set<string>()

export class Agent implements IAyaAgent {
  private modelConfig?: ModelConfig
  private preLLMHandlers: ContextHandler[] = []
  private postLLMHandlers: ContextHandler[] = []
  private preActionHandlers: ContextHandler[] = []
  private postActionHandlers: ContextHandler[] = []
  private services: Service[] = []
  private providers: Provider[] = []
  private actions: Action[] = []
  private plugins: Plugin[] = []
  private evaluators: Evaluator[] = []
  private runtime_: AgentcoinRuntime | undefined
  private pathResolver: PathResolver

  constructor(options?: { modelConfig?: ModelConfig; dataDir?: string }) {
    this.modelConfig = options?.modelConfig
    if (reservedAgentDirs.has(options?.dataDir)) {
      throw new Error('Data directory already used. Please provide a unique data directory.')
    }
    reservedAgentDirs.add(options?.dataDir)
    this.pathResolver = new PathResolver(options?.dataDir)
  }

  get runtime(): AgentcoinRuntime {
    if (!this.runtime_) {
      throw new Error('Runtime not initialized. Call start() first.')
    }
    return this.runtime_
  }

  get agentId(): UUID {
    return this.runtime.agentId
  }

  get knowledge(): IKnowledgeBaseService {
    return this.runtime.getService(KnowledgeBaseService)
  }

  get memories(): IMemoriesService {
    return this.runtime.getService(MemoriesService)
  }

  get wallet(): IWalletService {
    return this.runtime.getService(WalletService)
  }

  async start(): Promise<void> {
    let runtime: AgentcoinRuntime | undefined

    try {
      elizaLogger.info('Starting agent...')

      // step 1: provision the hardware if needed.
      const keychainService = new KeychainService(this.pathResolver.KEYPAIR_FILE)
      const agentcoinAPI = new AgentcoinAPI()
      const agentcoinService = new AgentcoinService(
        keychainService,
        agentcoinAPI,
        this.pathResolver
      )
      await agentcoinService.provisionIfNeeded()

      if (isNull(process.env.POSTGRES_URL)) {
        elizaLogger.error('POSTGRES_URL is not set, please set it in your .env file')
        process.exit(1)
      }

      // eagerly start event service
      const agentcoinCookie = await agentcoinService.getCookie()
      const agentcoinIdentity = await agentcoinService.getIdentity()
      const eventService = new EventService(agentcoinCookie, agentcoinAPI)
      void eventService.start()

      const walletService = new WalletService(
        agentcoinCookie,
        agentcoinIdentity,
        agentcoinAPI,
        keychainService.turnkeyApiKeyStamper
      )
      const processService = new ProcessService()
      const configService = new ConfigService(eventService, processService, this.pathResolver)

      // step 2: load character and initialize database
      elizaLogger.info('Loading character...')
      const [db, charString] = await Promise.all([
        initializeDatabase(),
        fs.promises.readFile(this.pathResolver.CHARACTER_FILE, 'utf8')
      ])

      const character: Character = keychainService.processCharacterSecrets(JSON.parse(charString))

      const modelConfig = this.modelConfig
      character.templates = {
        ...character.templates,
        messageHandlerTemplate: AGENTCOIN_MESSAGE_HANDLER_TEMPLATE
      }

      if (modelConfig) {
        character.modelProvider = modelConfig.provider
        character.modelEndpointOverride = modelConfig.endpoint
        character.settings = character.settings ?? {}
        character.settings.modelConfig = modelConfig
      }

      // Set elizaLogger to debug mode
      // elizaLogger.level = 'debug'
      // elizaLogger.debug('Logger set to debug mode')

      const token = modelConfig?.apiKey ?? getTokenForProvider(character.modelProvider, character)
      const cache = new CacheManager(new DbCacheAdapter(db, character.id))

      elizaLogger.info(elizaLogger.successesTitle, 'Creating runtime for character', character.name)

      runtime = new AgentcoinRuntime({
        eliza: {
          databaseAdapter: db,
          token,
          modelProvider: character.modelProvider,
          evaluators: [...this.evaluators],
          character,
          plugins: [bootstrapPlugin, agentcoinPlugin, ...this.plugins],
          providers: [...this.providers],
          actions: [...this.actions],
          services: [agentcoinService, walletService, configService, ...this.services],
          managers: [],
          cacheManager: cache,
          agentId: character.id
        },
        pathResolver: this.pathResolver
      })
      this.runtime_ = runtime

      const knowledgeBaseService = new KnowledgeBaseService(runtime)
      const memoriesService = new MemoriesService(runtime)

      // shutdown handler
      let isShuttingDown = false
      const shutdown = async (signal?: string): Promise<void> => {
        try {
          if (isShuttingDown) {
            return
          }
          isShuttingDown = true

          elizaLogger.warn(`Received ${signal} signal. Stopping agent...`)
          await Promise.all([configService.stop(), eventService.stop()])
          // , knowledgeService.stop()])
          elizaLogger.success('Agent stopped services successfully!')

          if (runtime) {
            try {
              const agentId = runtime.agentId
              elizaLogger.warn('Stopping agent runtime...', agentId)
              await runtime.stop()
              elizaLogger.success('Agent runtime stopped successfully!', agentId)
            } catch (error) {
              elizaLogger.error('Error stopping agent:', error)
            }
          }

          elizaLogger.success('The End.')
          process.exit(0)
        } catch (error) {
          elizaLogger.error('Error shutting down:', error)
          elizaLogger.success('The End.')
          process.exit(1)
        }
      }

      processService.setShutdownFunc(shutdown)

      process.once('SIGINT', () => {
        void shutdown('SIGINT')
      })
      process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
      })

      // initialize the runtime
      await this.runtime.initialize({
        eventHandler: (event, params) => this.handle(event, params)
      })

      this.runtime.clients = await initializeClients(this.runtime.character, this.runtime)
      this.register('service', knowledgeBaseService)
      this.register('service', memoriesService)

      // no need to await these. it'll lock up the main process
      // void knowledgeService.start()
      void configService.start()

      elizaLogger.info(`Started ${this.runtime.character.name} as ${this.runtime.agentId}`)
    } catch (error: unknown) {
      console.log('sdk error', error)
      elizaLogger.error(
        'Error creating agent:',
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              cause: error.cause
            }
          : String(error)
      )
      throw error
    }

    elizaLogger.success(
      'agent runtime started id:',
      runtime.agentId,
      'name',
      runtime.character.name
    )
  }

  register(kind: 'service', handler: Service): void
  register(kind: 'provider', handler: Provider): void
  register(kind: 'action', handler: Action): void
  register(kind: 'plugin', handler: Plugin): void
  register(kind: 'evaluator', handler: Evaluator): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(kind: string, handler: any): void {
    switch (kind) {
      case 'service':
        this.services.push(handler)
        if (this.runtime_) {
          void this.runtime.registerService(handler)
        }
        break
      case 'action':
        this.actions.push(handler)
        if (this.runtime_) {
          this.runtime.registerAction(handler)
        }
        break
      case 'provider':
        this.providers.push(handler)
        if (this.runtime_) {
          this.runtime.registerContextProvider(handler)
        }
        break
      case 'plugin':
        this.plugins.push(handler)
        if (this.runtime_) {
          this.runtime.plugins.push(handler)
        }
        break
      case 'evaluator':
        this.evaluators.push(handler)
        if (this.runtime_) {
          this.runtime.registerEvaluator(handler)
        }
        break
      default:
        throw new Error(`Unknown registration kind: ${kind}`)
    }
  }

  on(event: 'pre:llm', handler: ContextHandler): void
  on(event: 'post:llm', handler: ContextHandler): void
  on(event: 'pre:action', handler: ContextHandler): void
  on(event: 'post:action', handler: ContextHandler): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: any): void {
    switch (event) {
      case 'pre:llm':
        this.preLLMHandlers.push(handler)
        break
      case 'post:llm':
        this.postLLMHandlers.push(handler)
        break
      case 'pre:action':
        this.preActionHandlers.push(handler)
        break
      case 'post:action':
        this.postActionHandlers.push(handler)
        break
      default:
        throw new Error(`Unknown event: ${event}`)
    }
  }

  off(event: 'pre:llm', handler: ContextHandler): void
  off(event: 'post:llm', handler: ContextHandler): void
  off(event: 'pre:action', handler: ContextHandler): void
  off(event: 'post:action', handler: ContextHandler): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, handler: any): void {
    switch (event) {
      case 'pre:llm':
        this.preLLMHandlers = this.preLLMHandlers.filter((h) => h !== handler)
        break
      case 'post:llm':
        this.postLLMHandlers = this.postLLMHandlers.filter((h) => h !== handler)
        break
      case 'pre:action':
        this.preActionHandlers = this.preActionHandlers.filter((h) => h !== handler)
        break
      case 'post:action':
        this.postActionHandlers = this.postActionHandlers.filter((h) => h !== handler)
        break
      default:
        throw new Error(`Unknown event: ${event}`)
    }
  }

  private async handle(event: SdkEventKind, params: Context): Promise<boolean> {
    switch (event) {
      case 'pre:llm': {
        for (const handler of this.preLLMHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }

      case 'post:llm': {
        for (const handler of this.postLLMHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }

      case 'pre:action': {
        for (const handler of this.preActionHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }

      case 'post:action': {
        for (const handler of this.postActionHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }
    }

    return true
  }
}

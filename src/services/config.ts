import { AGENTCOIN_MONITORING_ENABLED } from '@/common/env'
import { isNull, isRequiredString } from '@/common/functions'
import { OperationQueue } from '@/common/lang/operation_queue'
import { PathResolver } from '@/common/path-resolver'
import { CharacterSchema, ServiceKind } from '@/common/types'
import { EventService } from '@/services/event'
import { IConfigService } from '@/services/interfaces'
import { ProcessService } from '@/services/process'
import { elizaLogger, IAgentRuntime, Service, ServiceType } from '@elizaos/core'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import net from 'net'
import simpleGit from 'simple-git'

export class ConfigService extends Service implements IConfigService {
  private readonly operationQueue = new OperationQueue(1)
  private isRunning = false
  private gitCommitHash: string | undefined
  private envvarsChecksum: string | undefined
  private characterChecksum: string | undefined
  private server: net.Server | undefined

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.config as unknown as ServiceType
  }

  constructor(
    private readonly eventService: EventService,
    private readonly processService: ProcessService,
    private readonly pathResolver: PathResolver
  ) {
    super()
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  async start(): Promise<void> {
    elizaLogger.info('Starting config service...')
    // disable in dev mode
    if (process.env.NODE_ENV !== 'production') {
      elizaLogger.info('Config service disabled in dev mode')
      return
    }

    if (!AGENTCOIN_MONITORING_ENABLED) {
      elizaLogger.info('Agentcoin monitoring disabled')
      return
    }

    if (this.isRunning) {
      return
    }

    this.isRunning = true

    // Start express server on Unix domain socket
    const app = express()

    app.get('/command/new', async (req, res) => {
      const { kind } = req.query
      elizaLogger.info(`Received command request: ${kind}`)

      try {
        switch (kind) {
          case 'git':
            res.json({ success: true })
            await this.checkCodeUpdate()
            break
          default:
            res.status(400).json({ error: `Invalid kind parameter: ${kind}` })
        }
      } catch (error) {
        elizaLogger.error('Error processing command:', error)
        res.status(500).json({ error: 'Internal server error' })
      }
    })

    // Remove existing socket file if it exists
    if (fs.existsSync(this.pathResolver.RUNTIME_SERVER_SOCKET_FILE)) {
      fs.unlinkSync(this.pathResolver.RUNTIME_SERVER_SOCKET_FILE)
    }

    this.server = app.listen(this.pathResolver.RUNTIME_SERVER_SOCKET_FILE)

    while (this.isRunning) {
      await Promise.all([this.checkCodeUpdate(), this.checkCharacterUpdate()])
      await new Promise((resolve) => setTimeout(resolve, 30000))
    }
  }

  async checkCharacterUpdate(): Promise<void> {
    await this.operationQueue.submit(async () => {
      // read character file
      const character = fs.readFileSync(this.pathResolver.CHARACTER_FILE, 'utf8')
      const checksum = crypto.createHash('md5').update(character).digest('hex')
      if (isNull(this.characterChecksum) || this.characterChecksum === checksum) {
        this.characterChecksum = checksum
        return
      }

      // kill the process and docker container should restart it
      elizaLogger.info(`New character file detected. Restarting agent...`)
      const characterObject = CharacterSchema.parse(
        JSON.parse(fs.readFileSync(this.pathResolver.CHARACTER_FILE, 'utf8'))
      )
      this.characterChecksum = checksum
      await this.eventService.publishCharacterChangeEvent(characterObject)
      if (process.env.NODE_ENV === 'production') {
        await this.processService.kill()
      }
    })
  }

  private async checkCodeUpdate(): Promise<void> {
    await this.operationQueue.submit(async () => {
      try {
        const git = simpleGit(this.pathResolver.CODE_DIR)
        const commitHash = (await git.revparse(['HEAD'])).trim()
        const remoteUrl = await git.remote(['get-url', 'origin'])

        if (!isRequiredString(remoteUrl)) {
          elizaLogger.error('No remote url found')
          return
        }

        if (isNull(this.gitCommitHash) || this.gitCommitHash === commitHash) {
          this.gitCommitHash = commitHash
        } else {
          // kill the process and docker container should restart it
          elizaLogger.info(
            `New code detected current=${this.gitCommitHash} new=${commitHash}. Restarting agent...`
          )
          this.gitCommitHash = commitHash
          await this.eventService.publishCodeChangeEvent(commitHash.trim(), remoteUrl.trim())
          if (process.env.NODE_ENV === 'production') {
            await this.processService.kill()
          }
        }
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.includes('Cannot use simple-git on a directory that does not exist')
        ) {
          elizaLogger.info('Git directory not initiated yet')
        } else {
          elizaLogger.error('Error checking git status:', e)
        }
      }
    })
  }

  async stop(): Promise<void> {
    this.isRunning = false
    if (this.server) {
      this.server.close()
      console.log('Closing server')
      if (fs.existsSync(this.pathResolver.RUNTIME_SERVER_SOCKET_FILE)) {
        console.log('Removing socket file')
        fs.unlinkSync(this.pathResolver.RUNTIME_SERVER_SOCKET_FILE)
      }
      this.server = undefined
    }
    elizaLogger.info('Stopping config service...')
  }
}

import { AGENTCOIN_FUN_API_URL, AGENTCOIN_MONITORING_ENABLED } from '@/common/env'
import {
  hasActions,
  isNull,
  isRequiredString,
  isValidSignature,
  serializeChannel,
  serializeIdentity
} from '@/common/functions'
import { AgentcoinRuntime } from '@/common/runtime'
import {
  AgentIdentitySchema,
  Character,
  ChatChannel,
  ChatChannelKind,
  EthAddressSchema,
  HydratedMessageSchema,
  Identity,
  Message,
  MessageEventSchema,
  SentinelCommand,
  SentinelCommandSchema
} from '@/common/types'
import * as fs from 'fs'

import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import { AGENTCOIN_MESSAGE_HANDLER_TEMPLATE } from '@/templates/message'
import {
  Client,
  composeContext,
  Content,
  elizaLogger,
  generateMessageResponse,
  IAgentRuntime,
  Memory,
  ModelClass,
  stringToUuid,
  UUID
} from '@elizaos/core'
import { io, Socket } from 'socket.io-client'
import { AGENT_ADMIN_PUBLIC_KEY } from '@/common/constants'

function messageIdToUuid(messageId: number): UUID {
  return stringToUuid('agentcoin:' + messageId.toString())
}

export class AgentcoinClient {
  private socket?: Socket
  private agentcoinService: AgentcoinService
  private configService: ConfigService

  constructor(private readonly runtime: AgentcoinRuntime) {
    elizaLogger.info('Connecting to Agentcoin API', AGENTCOIN_FUN_API_URL)
    this.agentcoinService = runtime.getService(AgentcoinService)
    this.configService = runtime.getService(ConfigService)
  }

  public async start(): Promise<void> {
    if (!isNull(this.socket)) {
      elizaLogger.info('Agentcoin client already started')
      return
    }

    this.socket = io(AGENTCOIN_FUN_API_URL, {
      reconnection: true,
      rejectUnauthorized: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      withCredentials: true,
      timeout: 20000,
      autoConnect: true,
      transports: ['websocket', 'polling'],
      extraHeaders: {
        Cookie: await this.agentcoinService.getCookie()
      },
      auth: async (cb: (data: unknown) => void) => {
        try {
          const jwtToken = await this.agentcoinService.getJwtAuthToken()
          cb({ jwtToken })
        } catch (error) {
          elizaLogger.error('Error getting JWT token', error)
          cb({})
        }
      }
    })

    this.socket.on('connect', () => {
      elizaLogger.info('Connected to Agentcoin API')
    })
    this.socket.on('disconnect', () => {
      elizaLogger.info('Disconnected from Agentcoin API')
    })

    const identity = await this.agentcoinService.getIdentity()
    const eventName = `user:${serializeIdentity(identity)}`
    elizaLogger.info(
      `agentcoin.fun (${process.env.npm_package_version}) client listening for event`,
      eventName
    )

    // listen on DMs
    this.socket.on(eventName, async (data: unknown) => {
      // elizaLogger.info('Agentcoin client received event', data)
      try {
        const event = MessageEventSchema.parse(data)
        const channel = event.channel

        if (channel.kind !== ChatChannelKind.DM) {
          elizaLogger.info('Agentcoin client received msg for unknown channel', channel)
          return
        }

        // validate channel
        if (channel.firstIdentity !== identity && channel.secondIdentity !== identity) {
          elizaLogger.info('Agentcoin client received msg for unknown channel', channel)
          return
        }

        switch (event.kind) {
          case 'message': {
            // process message if allowed
            await this.processMessage(channel, event.data)
            break
          }
          case 'status':
            elizaLogger.info('Received status', event.data.status)
            break
        }
      } catch (error) {
        console.error('Error processing message from agentcoin client', error)
        elizaLogger.error('Error processing message from agentcoin client', error)
      }
    })

    // listen on admin commands
    if (AGENTCOIN_MONITORING_ENABLED) {
      this.socket.on(`admin:${identity}`, async (payload: string) => {
        try {
          const jsonObj = JSON.parse(payload)
          const { content, signature } = jsonObj
          if (!isRequiredString(content) || !isRequiredString(signature)) {
            throw new Error('Invalid payload')
          }

          const adminPublicKey = this.runtime.getSetting(AGENT_ADMIN_PUBLIC_KEY)

          if (!isValidSignature(content, adminPublicKey, signature)) {
            throw new Error('Invalid signature')
          }

          const command = SentinelCommandSchema.parse(JSON.parse(content))
          await this.handleAdminCommand(command)
        } catch (e) {
          console.error('Error handling admin command:', e, payload)
        }
      })
    }
  }

  private async handleAdminCommand(command: SentinelCommand): Promise<void> {
    elizaLogger.info('handling admin command', command.kind)
    switch (command.kind) {
      case 'set_git':
        elizaLogger.info('ignoring set_git. sentinel service is handling this', command)
        break
      case 'set_character':
        await this.handleSetCharacter(command.character)
        break
      case 'set_knowledge':
        elizaLogger.info('ignoring set_knowledge', command)
        break
      case 'delete_knowledge':
        elizaLogger.info('ignoring delete_knowledge', command)
        break
      default:
        throw new Error('Invalid command')
    }
  }

  private async handleSetCharacter(character: Character): Promise<void> {
    // write the character to the character file
    await fs.promises.writeFile(
      this.runtime.pathResolver.CHARACTER_FILE,
      JSON.stringify(character, null, 2)
    )

    // notify config service
    await this.configService.checkCharacterUpdate()
  }

  public stop(): void {
    this.socket?.disconnect()
    this.socket = undefined
  }

  private async sendMessageAsAgent({
    identity,
    content,
    channel
  }: {
    identity: Identity
    content: Content
    channel: ChatChannel
  }): Promise<Memory> {
    const { text, action, inReplyTo, attachments } = content

    // FIXME: hish - need to update code to handle multiple attachments
    const firstAttachment = attachments?.[0]
    const imageUrl = firstAttachment?.url

    const agentcoinResponse = await this.agentcoinService.sendMessage({
      text: imageUrl ? text + ` ${imageUrl}` : text,
      sender: identity,
      channel,
      clientUuid: crypto.randomUUID()
    })

    return this.saveMessage({
      message: agentcoinResponse.message,
      action,
      inReplyTo
    })
  }

  private async saveMessage({
    message,
    action,
    inReplyTo
  }: {
    message: Message
    action?: string
    inReplyTo?: UUID
  }): Promise<Memory> {
    const roomId = stringToUuid(serializeChannel(message.channel))
    const messageId = messageIdToUuid(message.id)
    const userId = AgentIdentitySchema.safeParse(message.sender).success
      ? this.runtime.agentId
      : stringToUuid(serializeIdentity(message.sender))

    const responseMessage: Memory = {
      id: messageId,
      agentId: this.runtime.agentId,
      userId,
      roomId,
      content: {
        text: message.text,
        source: 'agentcoin',
        inReplyTo,
        agentCoinMessageId: message.id,
        action
      },
      createdAt: Date.now(),
      unique: true
    }

    // await this.runtime.messageManager.addEmbeddingToMemory(responseMessage)
    await this.runtime.messageManager.createMemory(responseMessage)

    return responseMessage
  }

  private async processMessage(channel: ChatChannel, data: unknown): Promise<void> {
    const messages = HydratedMessageSchema.array().parse(data)

    const { message, user } = messages[0]

    if (isNull(message)) {
      elizaLogger.info('AgentcoinClient received empty message')
      return
    }

    const identity = await this.agentcoinService.getIdentity()

    if (message.sender === identity) {
      return
    }

    await this.agentcoinService.sendStatus(channel, 'thinking')

    const roomId = stringToUuid(serializeChannel(channel))
    const userId = stringToUuid(serializeIdentity(message.sender))

    await this.runtime.ensureUserRoomConnection({
      roomId,
      userId,
      username: user.username,
      name: user.username,
      email: user.identity,
      bio: user.bio,
      ethAddress: EthAddressSchema.safeParse(user.identity).success ? user.identity : undefined,
      source: 'agentcoin'
    })

    const memory: Memory = await this.saveMessage({ message })

    let state = await this.runtime.composeState(memory, {
      agentName: this.runtime.character.name
    })

    await this.runtime.evaluate(memory, state)

    const context = composeContext({
      state,
      template: AGENTCOIN_MESSAGE_HANDLER_TEMPLATE
    })

    // `prellm` event
    let shouldContinue = await this.runtime.handle('pre:llm', {
      state,
      responses: [],
      memory
    })

    if (!shouldContinue) {
      elizaLogger.info('AgentcoinClient received prellm event but it was suppressed')
      await this.agentcoinService.sendStatus(channel, 'idle')
      return
    }

    await this.agentcoinService.sendStatus(channel, 'typing')

    const response = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.LARGE
    })

    // `postllm` event
    shouldContinue = await this.runtime.handle('post:llm', {
      state,
      responses: [],
      memory,
      content: response
    })

    if (!shouldContinue) {
      elizaLogger.info('AgentcoinClient received postllm event but it was suppressed')
      await this.agentcoinService.sendStatus(channel, 'idle')
      return
    }

    if (isNull(response.text) || response.text.trim().length === 0) {
      await this.agentcoinService.sendStatus(channel, 'idle')
      return
    }

    const action = this.runtime.actions.find((a) => a.name === response.action)
    const shouldSuppressInitialMessage = action?.suppressInitialMessage

    const messageResponses: Memory[] = []
    if (shouldSuppressInitialMessage) {
      elizaLogger.info('Agentcoin response is IGNORE', response)
    } else {
      const responseMessage = await this.sendMessageAsAgent({
        identity,
        content: response,
        channel
      })
      await this.runtime.evaluate(responseMessage, state, true)
      messageResponses.push(responseMessage)
      state = await this.runtime.updateRecentMessageState(state)
    }

    if (!hasActions(messageResponses)) {
      elizaLogger.info('AgentcoinClient received message with no actions. done!')
      return
    }

    if (messageResponses[0]?.content.action !== 'CONTINUE') {
      // if the action is not continue, we need to send a status update
      await this.agentcoinService.sendStatus(channel, 'thinking')
    }

    // `preaction` event
    shouldContinue = await this.runtime.handle('pre:action', {
      state,
      responses: messageResponses,
      memory
    })

    if (!shouldContinue) {
      elizaLogger.info('AgentcoinClient received preaction event but it was suppressed')
      await this.agentcoinService.sendStatus(channel, 'idle')
      return
    }

    await this.runtime.processActions(memory, messageResponses, state, async (newMessage) => {
      try {
        // `postaction` event
        shouldContinue = await this.runtime.handle('post:action', {
          state,
          responses: messageResponses,
          memory,
          content: newMessage
        })

        if (!shouldContinue) {
          elizaLogger.info('AgentcoinClient received postaction event but it was suppressed')
          return
        }

        const newMemory = await this.sendMessageAsAgent({
          identity,
          content: newMessage,
          channel
        })

        await this.runtime.evaluate(newMemory, state, true)

        return [newMemory]
      } catch (e) {
        elizaLogger.error(`error sending`, e)
        throw e
      }
    })
  }
}

export const AgentcoinClientInterface: Client = {
  start: async (_runtime: AgentcoinRuntime) => {
    const client = new AgentcoinClient(_runtime)
    await client.start()
    return client
  },
  stop: async (_runtime: IAgentRuntime, client?: Client) => {
    if (client instanceof AgentcoinClient) {
      client.stop()
    }
  }
}

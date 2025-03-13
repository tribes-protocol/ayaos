import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { isNull, toJsonTree } from '@/common/functions'
import { PathResolver } from '@/common/path-resolver'
import {
  AgentIdentity,
  AgentIdentitySchema,
  AgentRegistrationSchema,
  CharacterSchema,
  ChatChannel,
  CreateMessage,
  CredentialsSchema,
  HydratedMessage,
  Identity,
  MessageStatusEnum,
  ServiceKind,
  User
} from '@/common/types'
import { IAgentcoinService } from '@/services/interfaces'
import { KeychainService } from '@/services/keychain'
import { elizaLogger, IAgentRuntime, Service, ServiceType } from '@elizaos/core'
import * as fs from 'fs'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { USER_CREDENTIALS_FILE } from '@/common/constants'

export class AgentcoinService extends Service implements IAgentcoinService {
  private cachedCookie: string | undefined
  private cachedIdentity: Identity | undefined

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.agent as unknown as ServiceType
  }

  constructor(
    private readonly keychain: KeychainService,
    private readonly api: AgentcoinAPI,
    private readonly pathResolver: PathResolver
  ) {
    super()
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  async getUser(identity: Identity): Promise<User | undefined> {
    return this.api.getUser(identity)
  }

  async getIdentity(): Promise<Identity> {
    if (isNull(this.cachedIdentity)) {
      const { id } = CharacterSchema.parse(
        JSON.parse(fs.readFileSync(this.pathResolver.CHARACTER_FILE, 'utf-8'))
      )
      this.cachedIdentity = AgentIdentitySchema.parse(`AGENT-${id}`)
    }
    return this.cachedIdentity
  }

  async sendStatus(channel: ChatChannel, status: MessageStatusEnum): Promise<void> {
    const cookie = await this.getCookie()

    await this.api.sendStatus(
      {
        channel,
        status
      },
      { cookie }
    )
  }

  async sendMessage(message: CreateMessage): Promise<HydratedMessage> {
    const cookie = await this.getCookie()

    return this.api.sendMessage(message, { cookie })
  }

  public async login(identity: Identity): Promise<string> {
    const message = await this.api.loginMessageToSign(identity)
    const signature = await this.keychain.sign(message)

    if (isNull(signature)) {
      throw new Error('Failed to sign message')
    }

    const token = await this.api.login({ identity, message, signature })

    elizaLogger.success('Agent coin logged in successfully', identity)
    return token
  }

  async provisionIfNeeded(): Promise<void> {
    elizaLogger.info('Checking if agent coin is provisioned...')
    if (await this.isProvisioned()) {
      return
    }

    elizaLogger.info('Provisioning hardware...')

    const regPath = this.pathResolver.REGISTRATION_FILE

    if (!fs.existsSync(regPath)) {
      const agentId = await this.provisionPureAgent()
      elizaLogger.success('Agent coin provisioned successfully', agentId)
      return
    }

    const { registrationToken: token } = AgentRegistrationSchema.parse(
      JSON.parse(fs.readFileSync(regPath, 'utf-8'))
    )

    const signature = await this.keychain.sign(token)
    const publicKey = this.keychain.publicKey

    const character = await this.api.provisionAgent(token, signature, publicKey)
    fs.writeFileSync(
      this.pathResolver.CHARACTER_FILE,
      JSON.stringify(toJsonTree(character), null, 2)
    )

    elizaLogger.success('Agent coin provisioned successfully', character.id)

    fs.unlinkSync(regPath)
  }

  async getCookie(): Promise<string> {
    if (isNull(this.cachedCookie)) {
      const identity = await this.getIdentity()
      this.cachedCookie = await this.login(identity)
    }
    return this.cachedCookie
  }

  async getJwtAuthToken(): Promise<string> {
    const cookie = await this.getCookie()
    const match = cookie.match(/jwt_auth_token=([^;]+)/)
    if (!match) {
      throw new Error('Could not extract JWT token from cookie')
    }
    return match[1]
  }

  async provisionPureAgent(): Promise<AgentIdentity> {
    let token = await this.getCliAuthToken()
    if (isNull(token)) {
      token = await this.createCliAuthAndWaitForToken()
    }

    const message = this.keychain.publicKey
    const signature = await this.keychain.sign(message)

    const character = await this.api.createAgentFromCli(
      message,
      this.keychain.publicKey,
      signature,
      `jwt_auth_token=${token}`
    )

    fs.writeFileSync(
      this.pathResolver.CHARACTER_FILE,
      JSON.stringify(toJsonTree(character), null, 2)
    )

    const agentId = AgentIdentitySchema.parse(`AGENT-${character.id}`)

    // Display agent creation success message
    const agentUrl = `${AGENTCOIN_FUN_API_URL}/agent/${agentId}`
    const boxWidth = Math.max(70, agentUrl.length + 6) // Ensure minimum width of 70 chars

    console.log('\n┌' + '─'.repeat(boxWidth) + '┐')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  🎉 Congratulations! Your agent is created  '.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Check it out here:'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + `  ${agentUrl}`.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('└' + '─'.repeat(boxWidth) + '┘\n')

    return agentId
  }

  async getCliAuthToken(): Promise<string | undefined> {
    if (!fs.existsSync(USER_CREDENTIALS_FILE)) {
      return undefined
    }
    const credentials = CredentialsSchema.parse(
      JSON.parse(fs.readFileSync(USER_CREDENTIALS_FILE, 'utf-8'))
    )
    return credentials.token
  }

  async createCliAuthAndWaitForToken(): Promise<string> {
    // Create the CLI auth request and get the ID
    const id = await this.api.createCliAuthRequest()

    // Calculate the box width based on the URL length
    const url = `${AGENTCOIN_FUN_API_URL}/user/connect?id=${id}`
    const boxWidth = Math.max(70, url.length + 6) // Ensure minimum width of 70 chars

    // Print a fancy bordered URL message for the user
    console.log('\n┌' + '─'.repeat(boxWidth) + '┐')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  🔐 Authentication Required  '.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Please visit:'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + `  ${url}`.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Waiting for authentication...'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('└' + '─'.repeat(boxWidth) + '┘\n')

    // Poll for the response token
    let token: string | undefined
    let dots = 0
    const updateWaitingMessage = (): void => {
      process.stdout.write(`\r  Waiting${'.'.repeat(dots)}${' '.repeat(3 - dots)}`)
      dots = (dots + 1) % 4
    }

    const waitingInterval = setInterval(updateWaitingMessage, 500)

    try {
      while (isNull(token)) {
        await new Promise((resolve) => setTimeout(resolve, 1000))

        try {
          token = await this.api.getCliAuthRequest(id)
          if (token) {
            clearInterval(waitingInterval)
            console.log('\n\n┌' + '─'.repeat(boxWidth) + '┐')
            console.log('│' + ' '.repeat(boxWidth) + '│')
            console.log('│' + '  ✅ Authentication successful!'.padEnd(boxWidth - 1, ' ') + '│')
            console.log('│' + ' '.repeat(boxWidth) + '│')
            console.log('└' + '─'.repeat(boxWidth) + '┘\n')

            // Save the token to credentials.json
            fs.writeFileSync(
              USER_CREDENTIALS_FILE,
              JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2)
            )

            elizaLogger.success('Credentials saved to', USER_CREDENTIALS_FILE)
            return token
          }
        } catch (error) {
          clearInterval(waitingInterval)
          elizaLogger.error('Error polling for CLI auth token', error)
          throw new Error('Failed to authenticate via CLI')
        }
      }
    } catch (error) {
      clearInterval(waitingInterval)
      throw error
    }

    return token
  }

  private async isProvisioned(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.pathResolver.CHARACTER_FILE)) {
        return false
      }

      const character = CharacterSchema.parse(
        JSON.parse(fs.readFileSync(this.pathResolver.CHARACTER_FILE, 'utf-8'))
      )

      if (character.id) {
        return true
      }
    } catch (error) {
      console.log('Error parsing character file:', error)
      return false
    }
  }
}

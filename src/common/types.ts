import { isRequiredString, sortIdentities } from '@/common/functions'
import {
  Action,
  Content,
  Memory,
  ModelConfiguration,
  ModelProviderName,
  State
} from '@elizaos/core'
import { isAddress } from 'viem'
import { z } from 'zod'

export const ErrorResponseSchema = z.object({
  error: z.string()
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export const HexStringSchema = z.custom<`0x${string}`>(
  (val): val is `0x${string}` => typeof val === 'string' && /^0x[a-fA-F0-9]+$/.test(val)
)

export type HexString = z.infer<typeof HexStringSchema>

export const EthAddressSchema = z
  .custom<`0x${string}`>((val): val is `0x${string}` => typeof val === 'string' && isAddress(val))
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  .transform((arg) => arg.toLowerCase() as `0x${string}`)

export type EthAddress = z.infer<typeof EthAddressSchema>

export const SolAddressSchema = z.string().refine(
  (val) => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(val)
  },
  {
    message: 'Invalid Solana address format'
  }
)

export type SolAddress = z.infer<typeof SolAddressSchema>

export const WalletAddressSchema = z.union([EthAddressSchema, SolAddressSchema])

export type WalletAddress = z.infer<typeof WalletAddressSchema>

const AGENT_ID_REGEX =
  /^AGENT-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

export const AgentIdentitySchema =
  z.custom<`AGENT-${string}-${string}-${string}-${string}-${string}`>(
    (val): val is `AGENT-${string}-${string}-${string}-${string}-${string}` =>
      typeof val === 'string' && AGENT_ID_REGEX.test(val)
  )
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>

export const IdentitySchema = z.union([EthAddressSchema, AgentIdentitySchema])

export type Identity = z.infer<typeof IdentitySchema>

export const AgentResponseSchema = z.object({
  user: z.string().optional(),
  text: z.string(),
  action: z.string().optional()
})

export const BigintSchema = z.union([z.bigint(), z.string().transform((arg) => BigInt(arg))])

export const AgentMessageMetadataSchema = z.object({
  balance: z.coerce.bigint().nullable(),
  coinAddress: EthAddressSchema.nullable()
})

export type AgentMessageMetadata = z.infer<typeof AgentMessageMetadataSchema>

export enum ChatChannelKind {
  COIN = 'coin',
  DM = 'dm'
}
export const ChatChannelKindSchema = z.nativeEnum(ChatChannelKind)

export const CoinChannelSchema = z.object({
  kind: z.literal(ChatChannelKind.COIN),
  chainId: z.coerce.number().int().positive(),
  address: EthAddressSchema
})

export const DMChannelSchema = z
  .object({
    kind: z.literal(ChatChannelKind.DM),
    firstIdentity: IdentitySchema,
    secondIdentity: IdentitySchema
  })
  .transform((data) => {
    const [first, second] = sortIdentities(data.firstIdentity, data.secondIdentity)
    return {
      ...data,
      firstIdentity: first,
      secondIdentity: second
    }
  })

export const ChatChannelSchema = z.union([CoinChannelSchema, DMChannelSchema])

export type CoinChannel = z.infer<typeof CoinChannelSchema>
export type DMChannel = z.infer<typeof DMChannelSchema>
export type ChatChannel = z.infer<typeof ChatChannelSchema>

// User schema

export const UserSchema = z.object({
  id: z.number(),
  identity: IdentitySchema,
  username: z.string(),
  bio: z.string().nullable().optional(),
  image: z.string().nullable().optional()
})

export type User = z.infer<typeof UserSchema>

// Messaging schema

export const MessageSchema = z.object({
  id: z.number(),
  clientUuid: z.string(),
  channel: ChatChannelSchema,
  sender: IdentitySchema,
  text: z.string(),
  openGraphId: z.string().nullable(),
  metadata: AgentMessageMetadataSchema,
  createdAt: z.preprocess((arg) => (isRequiredString(arg) ? new Date(arg) : arg), z.date())
})

export type Message = z.infer<typeof MessageSchema>

export const CreateMessageSchema = MessageSchema.omit({
  id: true,
  createdAt: true,
  metadata: true
})

export type CreateMessage = z.infer<typeof CreateMessageSchema>

export const OG_KINDS = ['website', 'image', 'video', 'tweet', 'launch'] as const

export const OpenGraphSchema = z.object({
  id: z.string(),
  url: z.string(),
  kind: z.enum(OG_KINDS).default('website'),
  data: z.string(),
  createdAt: z.preprocess((arg) => (isRequiredString(arg) ? new Date(arg) : arg), z.date())
})

export const HydratedMessageSchema = z.object({
  message: MessageSchema,
  user: UserSchema,
  openGraph: OpenGraphSchema.optional().nullable()
})

export type HydratedMessage = z.infer<typeof HydratedMessageSchema>

export const AgentWalletKindSchema = z.enum(['evm', 'solana'])

export type AgentWalletKind = z.infer<typeof AgentWalletKindSchema>

export const AgentWalletSchema = z.object({
  id: z.number(),
  address: WalletAddressSchema,
  kind: AgentWalletKindSchema,
  label: z.string(),
  subOrganizationId: z.string(),
  createdAt: z.preprocess((arg) => (isRequiredString(arg) ? new Date(arg) : arg), z.date())
})

export type AgentWallet = z.infer<typeof AgentWalletSchema>

export const KeyPairSchema = z.object({
  publicKey: z.string(),
  privateKey: z.string()
})

export type KeyPair = z.infer<typeof KeyPairSchema>

// Transactions

export const TransactionSchema = z.object({
  to: EthAddressSchema,
  value: z
    .union([z.string(), z.bigint()])
    .transform((val) => (typeof val === 'string' ? BigInt(val) : val))
    .optional(),
  data: HexStringSchema.optional(),
  chainId: z.number().optional()
})

export type Transaction = z.infer<typeof TransactionSchema>

export const AgentRegistrationSchema = z.object({
  registrationToken: z.string()
})

export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>

export const GitStateSchema = z.object({
  repositoryUrl: z.string(),
  branch: z.string(),
  commit: z.string().optional().nullable()
})

export type GitState = z.infer<typeof GitStateSchema>

export const UserDmEventSchema = z.object({
  channel: DMChannelSchema,
  message: HydratedMessageSchema
})

export type UserEvent = z.infer<typeof UserDmEventSchema>

// Character schema

export const CharacterMessageSchema = z.object({
  user: z.string(),
  content: z.object({
    text: z.string()
  })
})

export type CharacterMessage = z.infer<typeof CharacterMessageSchema>

export const BaseCharacterSchema = z.object({
  system: z.string().optional().nullable(),
  bio: z.array(z.string()),
  lore: z.array(z.string()),
  knowledge: z.array(z.string()),
  messageExamples: z.array(z.array(CharacterMessageSchema)),
  postExamples: z.array(z.string()),
  topics: z.array(z.string()),
  style: z.object({
    all: z.array(z.string()),
    chat: z.array(z.string()),
    post: z.array(z.string())
  }),
  adjectives: z.array(z.string())
})

export type BaseCharacter = z.infer<typeof BaseCharacterSchema>

export const CharacterSchema = BaseCharacterSchema.extend({
  id: z.string(),
  name: z.string(),
  clients: z.array(z.string()),
  modelProvider: z.string(),
  settings: z
    .object({
      secrets: z.record(z.string()).optional().nullable(),
      voice: z
        .object({
          model: z.string()
        })
        .optional()
        .nullable()
    })
    .passthrough(),
  plugins: z.array(z.string())
})

export type Character = z.infer<typeof CharacterSchema>

// agent events

const BaseAgentEventSchema = z.object({
  sentAt: z.preprocess((arg) => (isRequiredString(arg) ? new Date(arg) : arg), z.date())
})

export const HealthAgentEventSchema = BaseAgentEventSchema.extend({
  kind: z.literal('health'),
  status: z.enum(['booting', 'running', 'stopped'])
})

export const CodeChangeAgentEventSchema = BaseAgentEventSchema.extend({
  kind: z.literal('code_change'),
  git: z.object({
    remoteUrl: z.string(),
    commit: z.string()
  })
})

export const CharacterChangeAgentEventSchema = BaseAgentEventSchema.extend({
  kind: z.literal('character_change'),
  character: CharacterSchema
})

export const EnvVarChangeAgentEventSchema = BaseAgentEventSchema.extend({
  kind: z.literal('env_var_change'),
  envVars: z.record(z.string(), z.string())
})

export const AgentEventDataSchema = z.discriminatedUnion('kind', [
  HealthAgentEventSchema,
  CodeChangeAgentEventSchema,
  CharacterChangeAgentEventSchema,
  EnvVarChangeAgentEventSchema
])

export type AgentEventData = z.infer<typeof AgentEventDataSchema>

// agentcoin admin commands

export const SentinelSetGitCommandSchema = z.object({
  kind: z.literal('set_git'),
  state: GitStateSchema
})

export const SentinelSetCharacterCommandSchema = z.object({
  kind: z.literal('set_character'),
  character: CharacterSchema
})

export const SentinelSetKnowledgeCommandSchema = z.object({
  kind: z.literal('set_knowledge'),
  url: z.string(),
  filename: z.string()
})

export const SentinelDeleteKnowledgeCommandSchema = z.object({
  kind: z.literal('delete_knowledge'),
  url: z.string(),
  filename: z.string()
})

export const SentinelCommandSchema = z.discriminatedUnion('kind', [
  SentinelSetGitCommandSchema,
  SentinelSetKnowledgeCommandSchema,
  SentinelDeleteKnowledgeCommandSchema,
  SentinelSetCharacterCommandSchema
])

export type SentinelCommand = z.infer<typeof SentinelCommandSchema>

export interface Context {
  memory?: Memory
  responses: Memory[]
  state?: State
  content?: Content
}

export type ContextHandler = (context: Context) => Promise<boolean>

export type SdkEventKind = 'pre:llm' | 'post:llm' | 'pre:action' | 'post:action'

export enum ServiceKind {
  wallet = 'wallet-service',
  config = 'config-service',
  agent = 'agent-service',
  knowledge = 'knowledge-service',
  knowledgeBase = 'knowledge-base-service',
  memories = 'memories-service'
}

const PdfFileSchema = z.object({
  kind: z.literal('pdf'),
  url: z.string()
})

const TxtFileSchema = z.object({
  kind: z.literal('txt'),
  url: z.string()
})

const MarkdownFileSchema = z.object({
  kind: z.literal('markdown'),
  url: z.string()
})

const DocxFileSchema = z.object({
  kind: z.literal('docx'),
  url: z.string()
})

const CsvFileSchema = z.object({
  kind: z.literal('csv'),
  url: z.string()
})

export const KnowledgeMetadataSchema = z.discriminatedUnion('kind', [
  PdfFileSchema,
  TxtFileSchema,
  MarkdownFileSchema,
  DocxFileSchema,
  CsvFileSchema
])

export const KnowledgeSchema = z.object({
  id: z.number(),
  metadata: KnowledgeMetadataSchema,
  name: z.string(),
  agentId: AgentIdentitySchema,
  createdAt: z.preprocess((arg) => (isRequiredString(arg) ? new Date(arg) : arg), z.date())
})

export type Knowledge = z.infer<typeof KnowledgeSchema>

export const MessageStatusEnumSchema = z.enum(['idle', 'thinking', 'typing'])
export type MessageStatusEnum = z.infer<typeof MessageStatusEnumSchema>

export const MessageStatusSchema = z.object({
  status: MessageStatusEnumSchema,
  user: UserSchema,
  createdAt: z.preprocess((arg) => (isRequiredString(arg) ? new Date(arg) : arg), z.date())
})

export type MessageStatus = z.infer<typeof MessageStatusSchema>

export const ChatStatusBodySchema = z.object({
  channel: ChatChannelSchema,
  status: MessageStatusEnumSchema
})

export type ChatStatusBody = z.infer<typeof ChatStatusBodySchema>

export const MessageEventKindSchema = z.enum(['message', 'status'])
export type MessageEventKind = z.infer<typeof MessageEventKindSchema>

export const MessageEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    data: HydratedMessageSchema.array(),
    channel: DMChannelSchema
  }),
  z.object({
    kind: z.literal('status'),
    data: MessageStatusSchema,
    channel: ChatChannelSchema
  })
])

export type MessageEvent = z.infer<typeof MessageEventSchema>

// type alias for some Eliza types
export type Tool = Action

export const CliAuthResponseSchema = z.object({
  id: z.string()
})

export type CliAuthResponse = z.infer<typeof CliAuthResponseSchema>

export const CliAuthRequestSchema = z.object({
  token: z.string()
})

export type CliAuthRequest = z.infer<typeof CliAuthRequestSchema>

export const CredentialsSchema = z.object({
  token: z.string()
})

export type Credentials = z.infer<typeof CredentialsSchema>

export type ModelConfig = ModelConfiguration & {
  provider: ModelProviderName
  endpoint?: string
  apiKey?: string
}

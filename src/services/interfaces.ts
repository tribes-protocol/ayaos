import {
  AgentWallet,
  AgentWalletKind,
  CreateMessage,
  HexString,
  HydratedMessage,
  Identity,
  Transaction,
  User
} from '@/common/types'

import { RagKnowledgeItemContent } from '@/common/schema'
import { Memory, RAGKnowledgeItem, UUID } from '@elizaos/core'

export interface IWalletService {
  signPersonalMessage(wallet: AgentWallet, message: string): Promise<string>
  signAndSubmitTransaction(wallet: AgentWallet, transaction: Transaction): Promise<HexString>
  getDefaultWallet(kind: AgentWalletKind): Promise<AgentWallet>
}

export interface IAgentcoinService {
  sendMessage(message: CreateMessage): Promise<HydratedMessage>
  getIdentity(): Promise<Identity>
  getUser(identity: Identity): Promise<User | undefined>
  getCookie(): Promise<string>
  getJwtAuthToken(): Promise<string>
}

export interface IConfigService {
  checkCharacterUpdate(): Promise<void>
}

export interface IKnowledgeBaseService {
  list(options: {
    limit?: number
    contentType?: string
    sortDirection?: 'asc' | 'desc'
  }): Promise<RAGKnowledgeItem[]>
  get(id: UUID): Promise<RAGKnowledgeItem | undefined>
  add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void>
  remove(id: UUID): Promise<void>
  search(options: {
    q: string
    limit: number
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]>
}

export interface IMemoriesService {
  search(options: {
    q: string
    limit: number
    type?: string
    matchThreshold?: number
  }): Promise<Memory[]>
}

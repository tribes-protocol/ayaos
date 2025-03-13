import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { isNull } from '@/common/functions'
import {
  AgentWallet,
  AgentWalletKind,
  HexString,
  Identity,
  ServiceKind,
  Transaction
} from '@/common/types'
import { IWalletService } from '@/services/interfaces'
import { IAgentRuntime, Service, ServiceType } from '@elizaos/core'
import { TurnkeyClient } from '@turnkey/http'
import { ApiKeyStamper } from '@turnkey/sdk-server'
import { createAccountWithAddress } from '@turnkey/viem'
import { Account, createWalletClient, getAddress, http, WalletClient } from 'viem'
import { base } from 'viem/chains'

export class WalletService extends Service implements IWalletService {
  private readonly turnkey: TurnkeyClient

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.wallet as unknown as ServiceType
  }

  constructor(
    private readonly agentcoinCookie: string,
    private readonly agentcoinIdentity: Identity,
    private readonly agentcoinAPI: AgentcoinAPI,
    apiKeyStamper: ApiKeyStamper
  ) {
    super()

    this.turnkey = new TurnkeyClient(
      {
        baseUrl: 'https://api.turnkey.com'
      },
      apiKeyStamper
    )
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  async getDefaultWallet(kind: AgentWalletKind): Promise<AgentWallet> {
    return this.agentcoinAPI.getDefaultWallet(this.agentcoinIdentity, kind, {
      cookie: this.agentcoinCookie
    })
  }

  async signPersonalMessage(wallet: AgentWallet, message: string): Promise<string> {
    const account = this.getAccount(wallet)
    if (isNull(account.signMessage)) {
      throw new Error('Failed to sign message. missing signMessage function')
    }
    return account.signMessage({ message })
  }

  async signAndSubmitTransaction(
    wallet: AgentWallet,
    transaction: Transaction
  ): Promise<HexString> {
    if (!isNull(transaction.chainId) && transaction.chainId !== base.id) {
      throw new Error(`Unsupported chainId: ${transaction.chainId}`)
    }

    const client: WalletClient = createWalletClient({
      account: this.getAccount(wallet),
      chain: base,
      transport: http(process.env.BASE_RPC_URL)
    })

    const txHash = await client.sendTransaction({
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      account: client.account,
      chain: base,
      // FIXME: hish - tackle kzg
      kzg: undefined
    })

    return txHash
  }

  private getAccount(wallet: AgentWallet): Account {
    const address = getAddress(wallet.address)
    const account = createAccountWithAddress({
      client: this.turnkey,
      organizationId: wallet.subOrganizationId,
      signWith: address,
      ethereumAddress: address
    })
    return account
  }
}

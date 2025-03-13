import { Agent } from '@/agent/agent'
import { elizaLogger } from '@elizaos/core'

async function main(): Promise<void> {
  try {
    console.log('hello, agent!')
    const agent = new Agent()
    console.log('agent created')
    agent.on('pre:llm', async (context) => {
      console.log('pre:llm', context.memory?.content)
      return true
    })
    console.log('pre:llm registered')

    agent.on('post:llm', async (context) => {
      console.log('post:llm', context.memory?.content)
      return true
    })
    console.log('post:llm registered')

    await agent.start()
    console.log('agent started', agent.agentId)
  } catch (error) {
    console.error(`error: ${error}`)
    process.exit(1)
  }
}

main().catch(elizaLogger.error)

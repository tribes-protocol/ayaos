import 'dotenv/config'

export const AGENTCOIN_FUN_API_URL = process.env.AGENTCOIN_FUN_API_URL || 'http://localhost:6900'

export const AGENTCOIN_MONITORING_ENABLED = process.env.AGENTCOIN_MONITORING_ENABLED === 'true'

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export const AGENTCOIN_FUN_DIR =
  process.env.AGENTCOIN_FUN_DIR ?? path.join(os.homedir(), '.agentcoin-fun')

export const AGENT_PROVISION_FILE = path.join(AGENTCOIN_FUN_DIR, 'agent-provision.json')

export const CHARACTER_FILE = path.join(AGENTCOIN_FUN_DIR, 'character.json')

export const ENV_FILE = path.join(AGENTCOIN_FUN_DIR, 'env.production')

export const REGISTRATION_FILE = path.join(AGENTCOIN_FUN_DIR, 'registration.json')

export const KEYPAIR_FILE = path.join(AGENTCOIN_FUN_DIR, 'agent-keypair.json')

export const GIT_STATE_FILE = path.join(AGENTCOIN_FUN_DIR, 'agent-git.json')

export const CODE_DIR = path.join(AGENTCOIN_FUN_DIR, 'code')

export const RUNTIME_SERVER_SOCKET_FILE = path.join(AGENTCOIN_FUN_DIR, 'runtime-server.sock')

export const AGENTCOIN_MONITORING_ENABLED = process.env.AGENTCOIN_MONITORING_ENABLED === 'true'

// make sure the `.agentcoin-fun` directory exists
if (!fs.existsSync(AGENTCOIN_FUN_DIR)) {
  fs.mkdirSync(AGENTCOIN_FUN_DIR, { recursive: true })
}

// UUID regex pattern with 5 groups of hexadecimal digits separated by hyphens
export const UUID_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/i

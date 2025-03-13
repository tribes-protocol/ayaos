import path from 'path'
import os from 'os'
// UUID regex pattern with 5 groups of hexadecimal digits separated by hyphens
export const UUID_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/i

export const USER_CREDENTIALS_FILE = path.join(os.homedir(), '.agentcoin-fun', 'credentials.json')

export const AGENT_ADMIN_PUBLIC_KEY = 'AGENT_ADMIN_PUBLIC_KEY'

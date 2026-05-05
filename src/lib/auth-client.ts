import { createAuthClient } from "better-auth/react"
import 'dotenv/config'

const authClient: ReturnType<typeof createAuthClient> = createAuthClient({
    baseURL: process.env.apiURL
})

export default authClient;
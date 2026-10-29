export function verifyWebhook(secret: string, signature: string, body: string, now?: number): Promise<{id: string; type: string; occurredAt: string; data: {id: string}}>

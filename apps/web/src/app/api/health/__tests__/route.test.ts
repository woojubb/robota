import { GET } from '../route'
import { NextRequest } from 'next/server'

// Mock process.uptime and process.memoryUsage
const mockUptime = jest.fn(() => 123.456)
const mockMemoryUsage = jest.fn(() => ({
    heapUsed: 50 * 1024 * 1024, // 50MB
    heapTotal: 100 * 1024 * 1024, // 100MB
    external: 10 * 1024 * 1024,
    arrayBuffers: 5 * 1024 * 1024,
    rss: 150 * 1024 * 1024,
}))

Object.defineProperty(process, 'uptime', {
    value: mockUptime
})

Object.defineProperty(process, 'memoryUsage', {
    value: mockMemoryUsage
})

describe('/api/health', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns healthy status with system information', async () => {
        const request = new NextRequest('http://localhost:3000/api/health')
        const response = await GET(request)

        expect(response.status).toBe(200)

        const data = await response.json()

        expect(data).toMatchObject({
            status: 'ok',
            timestamp: expect.any(String),
            environment: expect.any(String),
            version: expect.any(String),
            uptime: 123.456,
            memory: {
                used: 50,
                total: 100,
            },
            nodeVersion: process.version,
        })

        // Verify timestamp is recent (within last 5 seconds)
        const timestamp = new Date(data.timestamp)
        const now = new Date()
        const diffMs = now.getTime() - timestamp.getTime()
        expect(diffMs).toBeLessThan(5000)
    })

    it('sets correct cache headers', async () => {
        const request = new NextRequest('http://localhost:3000/api/health')
        const response = await GET(request)

        expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
        expect(response.headers.get('Pragma')).toBe('no-cache')
        expect(response.headers.get('Expires')).toBe('0')
    })

    it('handles errors gracefully', async () => {
        // Mock an error in process.uptime
        mockUptime.mockImplementationOnce(() => {
            throw new Error('System error')
        })

        const request = new NextRequest('http://localhost:3000/api/health')
        const response = await GET(request)

        expect(response.status).toBe(500)

        const data = await response.json()
        expect(data).toMatchObject({
            status: 'error',
            timestamp: expect.any(String),
            error: 'System error',
        })
    })
}) 
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const baseUrl = process.env.NEXTAUTH_URL || 'https://robota.dev';

    const robots = `User-agent: *
Allow: /

# Disallow private areas
Disallow: /api/
Disallow: /admin/
Disallow: /dashboard/
Disallow: /profile/
Disallow: /settings/
Disallow: /_next/
Disallow: /auth/

# Allow specific public API endpoints
Allow: /api/health
Allow: /api/sitemap
Allow: /api/robots

# Sitemap location
Sitemap: ${baseUrl}/sitemap.xml

# Crawl delay (optional)
Crawl-delay: 1`;

    return new NextResponse(robots, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 's-maxage=86400, stale-while-revalidate',
        },
    });
} 
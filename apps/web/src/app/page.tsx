import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { HeroSection } from '@/components/sections/hero-section'
import { FeaturesSection } from '@/components/sections/features-section'
import { DemoSection } from '@/components/sections/demo-section'
import { CTASection } from '@/components/sections/cta-section'

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <DemoSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  )
}

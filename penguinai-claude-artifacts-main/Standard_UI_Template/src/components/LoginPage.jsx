import { useState } from 'react'
import { useEffect } from 'react'
import { EyeIcon, EyeSlashIcon, UserIcon, LockClosedIcon } from '@heroicons/react/24/outline'

const LoginPage = ({ onLogin }) => {
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentSlide, setCurrentSlide] = useState(0)

  const slides = [
    {
      title: "Automate Repetitive Administrative Tasks",
      description: "Free your team from hours of data entry, intake, prior auth, and documentation review. PenguinAI automates it all - so your clinicians and ops teams can focus on people, not paperwork.",
      icon: "🤖",
      gradient: "from-blue-500 to-cyan-600"
    },
    {
      title: "Boost Operational Efficiency",
      description: "Deploy AI to handle 24/7 workload spikes, reduce delays, and maintain SLAs—without needing to scale your headcount linearly.",
      icon: "⚡",
      gradient: "from-purple-500 to-pink-600"
    },
    {
      title: "Reduce Human Error",
      description: "Minimize costly errors in billing, intake, and approvals through AI precision and validation logic tailored for healthcare compliance.",
      icon: "✅",
      gradient: "from-green-500 to-emerald-600"
    },
    {
      title: "Augment Your Team with Digital Workers",
      description: "Let AI handle the grunt work - Penguin's digital workers run background tasks, triage data, and follow up autonomously, while your humans focus on strategic care.",
      icon: "👥",
      gradient: "from-orange-500 to-red-600"
    },
    {
      title: "Scale for Future Growth",
      description: "PenguinAI is built for scale - modular, API-first, and system-agnostic. Onboard new processes or clinics without friction.",
      icon: "📈",
      gradient: "from-indigo-500 to-purple-600"
    },
    {
      title: "Unlock New Insights from Data",
      description: "Tap into structured intelligence from your unstructured documents. PenguinAI converts charts, PDFs, and messages into actionable insights.",
      icon: "🔍",
      gradient: "from-teal-500 to-blue-600"
    }
  ]

  // Auto-advance slides
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length)
    }, 5000) // Change slide every 5 seconds

    return () => clearInterval(timer)
  }, [slides.length])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          username,
          password,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        // Store token if provided (per auth-response contract: access_token)
        if (data.access_token) {
          localStorage.setItem('authToken', data.access_token)
        }
        onLogin()
      } else {
        // Error response contract: {detail: "message"}
        setError(data.detail || 'Login failed. Please check your credentials.')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Side - Branding and Features */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-100 via-gray-50 to-slate-100 relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-32 h-32 bg-blue-300 rounded-full blur-xl"></div>
          <div className="absolute bottom-32 right-16 w-40 h-40 bg-pink-300 rounded-full blur-xl"></div>
          <div className="absolute top-1/2 left-1/3 w-24 h-24 bg-purple-300 rounded-full blur-xl"></div>
        </div>

        <div className="relative z-10 flex flex-col justify-center px-16 py-12 h-full">
          {/* Logo and Brand */}
          <div className="mb-8">
            <div className="flex items-center mb-6">
              <div className="w-12 h-12 bg-white rounded-2xl shadow-lg flex items-center justify-center mr-4">
                <img src="/penguin-logo.svg" alt="Penguin Logo" className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">PenguinAI</h1>
                <p className="text-gray-600 text-sm">Healthcare native intelligence</p>
              </div>
            </div>
          </div>

          {/* Sliding Feature Cards */}
          <div className="flex-1 flex items-center">
            <div className="w-full relative">
              {/* Main Slide */}
              <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-2xl border border-white/30 min-h-[320px] flex flex-col justify-center transition-all duration-500">
                <div className={`w-16 h-16 bg-gradient-to-br ${slides[currentSlide].gradient} rounded-2xl flex items-center justify-center mb-6 shadow-lg`}>
                  <span className="text-2xl">{slides[currentSlide].icon}</span>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4 leading-tight">
                  {slides[currentSlide].title}
                </h3>
                <p className="text-gray-600 leading-relaxed text-base">
                  {slides[currentSlide].description}
                </p>
              </div>

              {/* Navigation Dots */}
              <div className="flex justify-center mt-6 space-x-2">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlide(index)}
                    className={`w-3 h-3 rounded-full transition-all duration-300 ${
                      index === currentSlide 
                        ? 'bg-gray-800 scale-110' 
                        : 'bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>

              {/* Navigation Arrows */}
              <button
                onClick={() => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length)}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 w-10 h-10 bg-white/80 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white transition-all duration-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => setCurrentSlide((prev) => (prev + 1) % slides.length)}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 w-10 h-10 bg-white/80 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-white transition-all duration-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-md">
          {/* Welcome Section */}
          <div className="text-center mb-8">
            <div className="lg:hidden mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <img src="/penguin-logo.svg" alt="Penguin Logo" className="w-10 h-10" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome to PenguinAI</h2>
            <p className="text-gray-600">AI driven synergy for informed decisions.</p>
          </div>

          {/* Login Form */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Username Field */}
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <UserIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white"
                    placeholder="Enter your username"
                    required
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <LockClosedIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white"
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors duration-200"
                  >
                    {showPassword ? (
                      <EyeSlashIcon className="h-5 w-5" />
                    ) : (
                      <EyeIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:transform-none shadow-lg"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                    Signing in...
                  </div>
                ) : (
                  'Sign in with Microsoft'
                )}
              </button>
            </form>

            {/* Additional Options */}
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-500">
                Need help? <a href="#" className="text-purple-600 hover:text-purple-700 font-medium">Contact support</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
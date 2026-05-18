import { useState } from 'react'
import { 
  HomeIcon, 
  UserIcon, 
  ChartBarIcon, 
  CogIcon, 
  BellIcon,
  MagnifyingGlassIcon,
  ArrowRightOnRectangleIcon,
  PlusIcon,
  EllipsisVerticalIcon,
  UsersIcon,
  CurrencyDollarIcon,
  ShoppingCartIcon,
  StarIcon,
  FireIcon,
  LightBulbIcon,
  RocketLaunchIcon,
  Bars3Icon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { ArrowTrendingUpIcon } from '@heroicons/react/24/outline'

const Dashboard = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

  // TEMPLATE: Mock data for demonstration. Replace with API fetch in production.
  // NOTE: API pagination contract uses "items" not "projects":
  //   { items: [...], total: N, page: N, page_size: N }
  // This mock uses "projects" for backwards compatibility with this demo.
  const projectsData = {
    "projects": [
      {
        "doc_id": "4494047",
        "created_date": "2025-07-09T13:39:32.567000",
        "status": "COMPLETED",
        "document_name": "Multiple Documents",
        "updated_date": "2025-07-09T13:46:24.891000",
        "accept_count": 26,
        "reject_count": 8,
        "remaining_count": 0,
        "review_status": "COMPLETED",
        "episode_id": "EP_4494047",
        "ai_generated_count": 34,
        "newly_added_count": 9,
        "accuracy_score": {
          "primary_score": "40/50",
          "secondary_score": "15/30",
          "sequencing_score": "10.294117647058824/20",
          "total_score": "65.29411764705883/100",
          "recall": "74.29",
          "details": {
            "found_primary": true,
            "found_optimal_primary": false,
            "secondary_accepted_percentage": "73.5%",
            "correct_sequencing": true
          }
        }
      },
      {
        "doc_id": "4489372",
        "created_date": "2025-07-09T04:19:40.912000",
        "status": "COMPLETED",
        "document_name": "Multiple Documents",
        "updated_date": "2025-07-09T04:25:59.821000",
        "accept_count": 14,
        "reject_count": 9,
        "remaining_count": 0,
        "review_status": "COMPLETED",
        "episode_id": "EP_4489372",
        "ai_generated_count": 23,
        "newly_added_count": 4,
        "accuracy_score": {
          "primary_score": "50/50",
          "secondary_score": "15/30",
          "sequencing_score": "1.1764705882352942/20",
          "total_score": "66.17647058823529/100",
          "recall": "77.78",
          "details": {
            "found_primary": true,
            "found_optimal_primary": true,
            "secondary_accepted_percentage": "76.5%",
            "correct_sequencing": true
          }
        }
      },
      {
        "doc_id": "4487398",
        "created_date": "2025-07-09T04:19:32.722000",
        "status": "COMPLETED",
        "document_name": "Multiple Documents",
        "updated_date": "2025-07-09T04:24:44.423000",
        "accept_count": 10,
        "reject_count": 10,
        "remaining_count": 0,
        "review_status": "COMPLETED",
        "episode_id": "EP_4487398",
        "ai_generated_count": 20,
        "newly_added_count": 4,
        "accuracy_score": {
          "primary_score": "0/50",
          "secondary_score": "15/30",
          "sequencing_score": "0.0/20",
          "total_score": "15.0/100",
          "recall": "71.43",
          "details": {
            "found_primary": false,
            "found_optimal_primary": false,
            "secondary_accepted_percentage": "76.9%",
            "correct_sequencing": true
          }
        }
      },
      {
        "doc_id": "4481607",
        "created_date": "2025-07-09T04:19:20.639000",
        "status": "COMPLETED",
        "document_name": "Multiple Documents",
        "updated_date": "2025-07-09T04:25:45.124000",
        "accept_count": 12,
        "reject_count": 11,
        "remaining_count": 0,
        "review_status": "COMPLETED",
        "episode_id": "EP_4481607",
        "ai_generated_count": 23,
        "newly_added_count": 1,
        "accuracy_score": {
          "primary_score": "50/50",
          "secondary_score": "15/30",
          "sequencing_score": "9.166666666666666/20",
          "total_score": "74.16666666666667/100",
          "recall": "92.31",
          "details": {
            "found_primary": true,
            "found_optimal_primary": true,
            "secondary_accepted_percentage": "91.7%",
            "correct_sequencing": true
          }
        }
      },
      {
        "doc_id": "4480028",
        "created_date": "2025-07-08T19:04:13.607000",
        "status": "COMPLETED",
        "document_name": "Multiple Documents",
        "updated_date": "2025-07-08T19:08:47.600000",
        "accept_count": 2,
        "reject_count": 9,
        "remaining_count": 0,
        "review_status": "COMPLETED",
        "episode_id": "EP_4480028",
        "ai_generated_count": 11,
        "newly_added_count": 10,
        "accuracy_score": {
          "primary_score": "50/50",
          "secondary_score": "0/30",
          "sequencing_score": "10.0/20",
          "total_score": "60.0/100",
          "recall": "16.67",
          "details": {
            "found_primary": true,
            "found_optimal_primary": true,
            "secondary_accepted_percentage": "9.1%",
            "correct_sequencing": true
          }
        }
      }
    ]
  }

  const sidebarItems = [
    { id: 'dashboard', name: 'Dashboard', icon: HomeIcon }
  ]

  const stats = [
    { 
      name: 'Total Projects', 
      value: projectsData.projects.length.toString(), 
      change: '+5%', 
      changeType: 'positive',
      icon: ShoppingCartIcon,
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600'
    },
    { 
      name: 'Completed', 
      value: projectsData.projects.filter(p => p.status === 'COMPLETED').length.toString(), 
      change: '+12%', 
      changeType: 'positive',
      icon: StarIcon,
      color: 'from-green-500 to-green-600',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600'
    },
    { 
      name: 'Avg Accuracy', 
      value: Math.round(projectsData.projects.reduce((acc, p) => acc + parseFloat(p.accuracy_score.total_score.split('/')[0]), 0) / projectsData.projects.length) + '%', 
      change: '+8%', 
      changeType: 'positive',
      icon: ArrowTrendingUpIcon,
      color: 'from-orange-500 to-orange-600',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600'
    },
    { 
      name: 'Avg Recall', 
      value: Math.round(projectsData.projects.reduce((acc, p) => acc + parseFloat(p.accuracy_score.recall), 0) / projectsData.projects.length) + '%', 
      change: '+2.1%', 
      changeType: 'positive',
      icon: CurrencyDollarIcon,
      color: 'from-purple-500 to-purple-600',
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-600'
    },
  ]

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getScoreColor = (score) => {
    const numScore = parseFloat(score.split('/')[0])
    if (numScore >= 80) return 'text-green-600 bg-green-50'
    if (numScore >= 60) return 'text-yellow-600 bg-yellow-50'
    return 'text-red-600 bg-red-50'
  }

  const quickActions = [
    { name: 'Add New User', icon: PlusIcon, color: 'from-blue-500 to-blue-600', hoverColor: 'hover:from-blue-600 hover:to-blue-700' },
    { name: 'Create Project', icon: RocketLaunchIcon, color: 'from-orange-500 to-orange-600', hoverColor: 'hover:from-orange-600 hover:to-orange-700' },
    { name: 'Generate Report', icon: ChartBarIcon, color: 'from-purple-500 to-purple-600', hoverColor: 'hover:from-purple-600 hover:to-purple-700' },
  ]

  const getActivityIcon = (type) => {
    switch (type) {
      case 'create': return '🚀'
      case 'update': return '✏️'
      case 'complete': return '✅'
      case 'add': return '👥'
      default: return '📝'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-orange-50 flex">
      {/* Sidebar */}
      <div className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-white/80 backdrop-blur-sm shadow-2xl border-r border-gray-200/50 transition-all duration-300`}>
        {/* Toggle Button */}
        <div className="p-4 border-b border-gray-200/50">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-[#fc459d] hover:bg-pink-50 rounded-lg transition-all duration-300"
          >
            {sidebarCollapsed ? (
              <Bars3Icon className="w-5 h-5" />
            ) : (
              <XMarkIcon className="w-5 h-5" />
            )}
          </button>
        </div>
        
        {!sidebarCollapsed && (
          <div className="p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shadow-lg">
                <img src="/penguin-logo.svg" alt="Penguin Logo" className="w-6 h-6" />
              </div>
              <div className="ml-3">
                <img src="/Penguinai-name.png" alt="PenguinAI" className="h-6" />
                <p className="text-xs text-gray-500">Dashboard</p>
              </div>
            </div>
          </div>
        )}
        
        <nav className="mt-6">
          {sidebarItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center px-6 py-4 text-left transition-all duration-300 ${
                  activeTab === item.id
                    ? 'bg-gradient-to-r from-pink-50 to-purple-50 text-[#fc459d] border-r-4 border-[#fc459d] shadow-lg'
                    : 'text-gray-600 hover:bg-gradient-to-r hover:from-gray-50 hover:to-pink-50 hover:text-gray-900'
                }`}
                title={sidebarCollapsed ? item.name : ''}
              >
                <Icon className={`w-5 h-5 ${sidebarCollapsed ? 'mx-auto' : 'mr-3'}`} />
                {!sidebarCollapsed && <span className="font-medium">{item.name}</span>}
              </button>
            )
          })}
        </nav>

        <div className={`absolute bottom-6 ${sidebarCollapsed ? 'left-2 right-2' : 'left-6 right-6'}`}>
          <button
            onClick={onLogout}
            className="w-full flex items-center px-4 py-3 text-gray-600 hover:text-[#fc459d] hover:bg-pink-50 rounded-xl transition-all duration-300 font-medium"
            title={sidebarCollapsed ? 'Logout' : ''}
          >
            <ArrowRightOnRectangleIcon className={`w-5 h-5 ${sidebarCollapsed ? 'mx-auto' : 'mr-3'}`} />
            {!sidebarCollapsed && 'Logout'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-sm shadow-lg border-b border-gray-200/50">
          <div className="flex items-center justify-between px-8 py-6">
            <div className="flex items-center">
              <img src="/penguin-logo.svg" alt="Penguin Logo" className="w-8 h-8 mr-3" />
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#fc459d] to-pink-600 bg-clip-text text-transparent capitalize">{activeTab}</h1>
            </div>
            
            <div className="flex items-center space-x-6">
              {/* Search */}
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  className="pl-10 pr-4 py-3 w-80 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fc459d] focus:border-transparent bg-white/70 backdrop-blur-sm transition-all duration-300"
                />
              </div>
              
              {/* Notifications */}
              <button className="relative p-3 text-gray-400 hover:text-[#fc459d] transition-colors duration-300 bg-white/70 rounded-xl hover:bg-pink-50">
                <BellIcon className="w-6 h-6" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-gradient-to-r from-[#fc459d] to-pink-600 rounded-full animate-pulse"></span>
              </button>
              
              {/* Profile */}
              <div className="flex items-center bg-white/70 rounded-xl px-4 py-2 hover:bg-pink-50 transition-all duration-300">
                <div className="w-10 h-10 bg-gradient-to-br from-[#fc459d] to-pink-600 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-white font-bold text-sm">DU</span>
                </div>
                <div className="ml-3">
                  <span className="text-sm font-semibold text-gray-700">Demo User</span>
                  <p className="text-xs text-gray-500">Administrator</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 p-8">
          <div className="space-y-8">
            {/* Welcome Banner */}
            <div className="bg-gradient-to-r from-[#fc459d] via-purple-600 to-pink-600 rounded-2xl p-8 text-white shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold mb-2">Welcome back, Demo User! 🐧</h2>
                  <p className="text-pink-100 text-lg">Here's what's happening with your PenguinAI dashboard today.</p>
                </div>
                <div className="hidden md:block">
                  <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                    <img src="/penguin-logo.svg" alt="Penguin Logo" className="w-12 h-12" />
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat) => {
                const Icon = stat.icon
                return (
                  <div key={stat.name} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-6 border border-gray-200/50 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1">
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-12 h-12 ${stat.bgColor} rounded-xl flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 ${stat.iconColor}`} />
                      </div>
                      <div className={`text-sm font-bold px-3 py-1 rounded-full ${
                        stat.changeType === 'positive' 
                          ? 'text-green-700 bg-green-100' 
                          : 'text-red-700 bg-red-100'
                      }`}>
                        {stat.change}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600 mb-1">{stat.name}</p>
                      <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Projects Table */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50">
              <div className="p-6 border-b border-gray-200/50">
                <h3 className="text-xl font-bold text-gray-900 mb-2">Recent Projects</h3>
                <p className="text-gray-600">Overview of your latest document processing projects</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Document ID</th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Accept/Reject</th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Accuracy</th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recall</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/50">
                    {projectsData.projects.slice(0, 8).map((project) => (
                      <tr key={project.doc_id} className="hover:bg-gray-50/50 transition-colors duration-200">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                              <span className="text-blue-600 font-semibold text-xs">
                                {project.doc_id.includes('DOC_') ? 'D' : project.doc_id.slice(-2)}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{project.doc_id}</div>
                              <div className="text-sm text-gray-500">{project.episode_id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                            {project.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(project.created_date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-700">
                              ✓ {project.accept_count}
                            </span>
                            <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-700">
                              ✗ {project.reject_count}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getScoreColor(project.accuracy_score.total_score)}`}>
                            {Math.round(parseFloat(project.accuracy_score.total_score.split('/')[0]))}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">
                            {Math.round(parseFloat(project.accuracy_score.recall))}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-200/50">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">1</span> to <span className="font-medium">8</span> of{' '}
                    <span className="font-medium">{projectsData.projects.length}</span> projects
                  </p>
                  <button className="text-sm text-[#fc459d] hover:text-pink-700 font-medium">
                    View all projects →
                  </button>
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  )
}

export default Dashboard
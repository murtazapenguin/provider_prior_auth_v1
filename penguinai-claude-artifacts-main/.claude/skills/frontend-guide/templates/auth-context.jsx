/**
 * Authentication Context for JWT-based authentication
 *
 * Provides:
 * - Token storage in localStorage
 * - Automatic token validation on mount
 * - Login/logout functions
 * - useAuth hook for consuming auth state
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';

// Create the auth context
const AuthContext = createContext(null);

/**
 * Auth Provider Component
 *
 * Wrap your app with this provider to enable authentication
 *
 * @example
 * // main.jsx
 * import { AuthProvider } from './context/AuthContext';
 *
 * createRoot(document.getElementById('root')).render(
 *   <AuthProvider>
 *     <App />
 *   </AuthProvider>
 * );
 */
export const AuthProvider = ({ children }) => {
  // Initialize token from localStorage
  const [token, setToken] = useState(() => localStorage.getItem('authToken'));
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Update axios header and localStorage when token changes
  useEffect(() => {
    if (token) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      localStorage.setItem('authToken', token);
    } else {
      delete apiClient.defaults.headers.common['Authorization'];
      localStorage.removeItem('authToken');
    }
  }, [token]);

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        // Validate token by fetching user info
        const response = await apiClient.get('/auth/me');
        setUser(response.data);
        setError(null);
      } catch (err) {
        // Token invalid or expired
        console.error('Token validation failed:', err);
        setToken(null);
        setUser(null);
        setError('Session expired. Please login again.');
      } finally {
        setIsLoading(false);
      }
    };

    validateToken();
  }, [token]);

  /**
   * Login with email and password
   *
   * @param {string} email - User's email
   * @param {string} password - User's password
   * @returns {Promise<object>} User data on success
   * @throws {Error} On login failure
   *
   * @example
   * const { login } = useAuth();
   *
   * const handleSubmit = async (e) => {
   *   e.preventDefault();
   *   try {
   *     await login(email, password);
   *     navigate('/dashboard');
   *   } catch (error) {
   *     setError(error.message);
   *   }
   * };
   */
  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.post('/auth/login', {
        email,
        password,
      });

      const { token: newToken, user: userData } = response.data;

      if (!newToken) {
        throw new Error('No token received from server');
      }

      setToken(newToken);
      setUser(userData);

      return userData;
    } catch (err) {
      const errorMessage =
        err.response?.data?.detail ||
        err.message ||
        'Login failed. Please check your credentials.';

      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Logout the current user
   *
   * Clears token, user state, and redirects if needed
   *
   * @example
   * const { logout } = useAuth();
   *
   * const handleLogout = () => {
   *   logout();
   *   navigate('/login');
   * };
   */
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  /**
   * Clear any authentication errors
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Context value
  const value = {
    // State
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    error,

    // Actions
    login,
    logout,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to access authentication context
 *
 * @returns {object} Auth context value
 * @throws {Error} If used outside AuthProvider
 *
 * @example
 * const { user, isAuthenticated, login, logout } = useAuth();
 *
 * if (isAuthenticated) {
 *   return <div>Welcome, {user.name}</div>;
 * }
 */
export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};

// ============================================================
// API CLIENT CONFIGURATION
// ============================================================

/**
 * Axios API Client with JWT interceptor
 *
 * This should be in a separate file: api/client.js
 *
 * @example
 * // api/client.js
 * import axios from 'axios';
 *
 * // ALWAYS use relative URL — works with Vite proxy (local) and nginx (Docker)
 * const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
 *
 * export const apiClient = axios.create({
 *   baseURL: API_BASE_URL,
 *   headers: {
 *     'Content-Type': 'application/json',
 *   },
 * });
 *
 * // Response interceptor for 401 handling
 * apiClient.interceptors.response.use(
 *   (response) => response,
 *   (error) => {
 *     if (error.response?.status === 401) {
 *       // Token expired or invalid
 *       localStorage.removeItem('authToken');
 *       window.location.href = '/login';
 *     }
 *     return Promise.reject(error);
 *   }
 * );
 */

// ============================================================
// PROTECTED ROUTE COMPONENT
// ============================================================

/**
 * Protected Route Component
 *
 * Wraps routes that require authentication
 *
 * @example
 * // App.jsx
 * import { ProtectedRoute } from './context/AuthContext';
 *
 * <Routes>
 *   <Route path="/login" element={<LoginPage />} />
 *   <Route path="/" element={
 *     <ProtectedRoute>
 *       <AppLayout />
 *     </ProtectedRoute>
 *   }>
 *     <Route path="dashboard" element={<Dashboard />} />
 *   </Route>
 * </Routes>
 */
import { Navigate } from 'react-router-dom';

export const ProtectedRoute = ({ children, redirectTo = '/login' }) => {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading spinner while validating token
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
};

// ============================================================
// LOGIN PAGE COMPONENT EXAMPLE
// ============================================================

/**
 * Example Login Page Component
 *
 * @example
 * // components/auth/LoginPage.jsx
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EyeIcon, EyeSlashIcon, UserIcon, LockClosedIcon } from '@heroicons/react/24/outline';

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    clearError();

    if (!email.trim() || !password.trim()) {
      setLocalError('Please enter both email and password');
      return;
    }

    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setLocalError(err.message);
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
          <p className="text-gray-600">Sign in to your account</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 focus:bg-white"
                  placeholder="Enter your email"
                  disabled={isLoading}
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
                  className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 focus:bg-white"
                  placeholder="Enter your password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
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
            {displayError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-red-600 text-sm">{displayError}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:transform-none shadow-lg"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  Signing in...
                </div>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AuthContext;

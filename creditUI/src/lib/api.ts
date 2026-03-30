import axios from "axios"

const API_BASE_URL = import.meta.env.VITE_USE_LOCAL_BACKEND === 'true' 
  ? "http://localhost:5001" 
  : import.meta.env.VITE_BACKEND_URL

export const api = axios.create({
  baseURL: API_BASE_URL,
})

// Auto-inject JWT token for authenticated requests
api.interceptors.request.use((config) => {
  const userInfo = localStorage.getItem('userInfo')
  if (userInfo) {
    try {
      const { token } = JSON.parse(userInfo)
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    } catch (e) {
      console.error("Auth token parse error", e)
    }
  }
  return config
})

export default api

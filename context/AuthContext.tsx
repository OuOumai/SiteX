import React, { createContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  api,
  User,
  LoginPayload,
  RegisterPayload,
  UpdateProfilePayload,
  ChangePasswordPayload,
  RoleRequest,
} from '@/services/api';

const TOKEN_KEY = 'sitex_auth_token';
const REFRESH_TOKEN_KEY = 'sitex_auth_refresh_token';
const USER_KEY = 'sitex_auth_user';

function decodeBase64(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) return '';
  for (let bc = 0, bs = 0, buffer, idx = 0; (buffer = str.charAt(idx++)); ) {
    const charIndex = chars.indexOf(buffer);
    if (~charIndex) {
      bs = bc % 4 ? bs * 64 + charIndex : charIndex;
      if (bc++ % 4) {
        output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
      }
    }
  }
  return output;
}

function isTokenExpired(token: string, bufferSeconds = 30): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = typeof atob === 'function' ? atob(base64) : decodeBase64(base64);
    if (!decoded) return true;
    const jsonPayload = JSON.parse(decoded);
    if (!jsonPayload || !jsonPayload.exp) return false;
    return Date.now() >= (jsonPayload.exp * 1000) - (bufferSeconds * 1000);
  } catch {
    return true;
  }
}

async function getStoredItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        return window.localStorage.getItem(key);
      }
      return null;
    }
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.warn(`SecureStore getItem error for ${key}:`, error);
    return null;
  }
}

async function setStoredItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, value);
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.warn(`SecureStore setItem error for ${key}:`, error);
  }
}

async function removeStoredItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.warn(`SecureStore deleteItem error for ${key}:`, error);
  }
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: UpdateProfilePayload) => Promise<void>;
  changePassword: (payload: ChangePasswordPayload) => Promise<void>;
  uploadPhoto: (imageUri: string) => Promise<void>;
  deletePhoto: () => Promise<void>;
  submitRoleRequest: (roleId: number) => Promise<RoleRequest>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Subscribe to API client token refresh and session expiration events
  useEffect(() => {
    const unsubRefresh = api.addTokenRefreshedListener(async (newToken, newRefreshToken, freshUser) => {
      setToken(newToken);
      await setStoredItem(TOKEN_KEY, newToken);
      if (newRefreshToken) {
        await setStoredItem(REFRESH_TOKEN_KEY, newRefreshToken);
      }
      if (freshUser) {
        setUser(freshUser);
        await setStoredItem(USER_KEY, JSON.stringify(freshUser));
      }
    });

    const unsubExpired = api.addSessionExpiredListener(async () => {
      if (__DEV__) console.log('[AuthContext] Session expired, clearing credentials');
      setToken(null);
      setUser(null);
      api.setTokens(null, null);
      await removeStoredItem(TOKEN_KEY);
      await removeStoredItem(REFRESH_TOKEN_KEY);
      await removeStoredItem(USER_KEY);
    });

    return () => {
      unsubRefresh();
      unsubExpired();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: ensure startup screen is guaranteed to resolve even if device storage hangs
    const safetyTimer = setTimeout(() => {
      if (isMounted) setIsLoading(false);
    }, 2500);

    async function loadStoredAuth() {
      try {
        const storedToken = await getStoredItem(TOKEN_KEY);
        const storedRefreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
        const storedUserJson = await getStoredItem(USER_KEY);

        if (!isMounted) return;

        if (storedToken && storedUserJson) {
          api.setTokens(storedToken, storedRefreshToken);

          // Check if stored access token is expired
          if (isTokenExpired(storedToken)) {
            if (__DEV__) console.log('[Auth] Stored access token expired, recovering session via refresh...');
            try {
              const refreshed = await api.refreshAuthSession(storedRefreshToken || undefined, storedToken);
              if (refreshed && refreshed.token && isMounted) {
                if (__DEV__) console.log('[Auth] Session restored successfully');
                setToken(refreshed.token);
                setUser(refreshed.user);
                await setStoredItem(TOKEN_KEY, refreshed.token);
                if (refreshed.refreshToken) {
                  await setStoredItem(REFRESH_TOKEN_KEY, refreshed.refreshToken);
                }
                await setStoredItem(USER_KEY, JSON.stringify(refreshed.user));
                api.setTokens(refreshed.token, refreshed.refreshToken || null);
                clearTimeout(safetyTimer);
                setIsLoading(false);
                return;
              }
            } catch (refErr: any) {
              if (__DEV__) console.log('[Auth] Startup session recovery failed:', refErr?.message);
              // Clean up unrecoverable session so user sees clean login screen
              await removeStoredItem(TOKEN_KEY);
              await removeStoredItem(REFRESH_TOKEN_KEY);
              await removeStoredItem(USER_KEY);
              api.setTokens(null, null);
              if (isMounted) {
                setToken(null);
                setUser(null);
                clearTimeout(safetyTimer);
                setIsLoading(false);
              }
              return;
            }
          }

          // Valid token
          setToken(storedToken);
          setUser(JSON.parse(storedUserJson));

          // Release the initial startup screen immediately so the UI opens without delay
          clearTimeout(safetyTimer);
          setIsLoading(false);

          // Silently refresh latest profile from server in background
          api.getCurrentUser(storedToken)
            .then(async (freshUser) => {
              if (isMounted) {
                setUser(freshUser);
                await setStoredItem(USER_KEY, JSON.stringify(freshUser));
              }
            })
            .catch((e) => {
              if (__DEV__) console.log('[Auth] Background profile refresh deferred:', e?.message);
            });
          return;
        }
      } catch (err) {
        console.error('Failed to load auth state from secure storage:', err);
      } finally {
        if (isMounted) {
          clearTimeout(safetyTimer);
          setIsLoading(false);
        }
      }
    }

    loadStoredAuth();

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
    };
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    setIsLoading(true);
    try {
      const response = await api.login(payload);
      setToken(response.token);
      api.setTokens(response.token, response.refreshToken || null);
      await setStoredItem(TOKEN_KEY, response.token);
      if (response.refreshToken) {
        await setStoredItem(REFRESH_TOKEN_KEY, response.refreshToken);
      }

      // Fetch complete user profile including role requests
      try {
        const fullUser = await api.getCurrentUser(response.token);
        setUser(fullUser);
        await setStoredItem(USER_KEY, JSON.stringify(fullUser));
      } catch {
        setUser(response.user);
        await setStoredItem(USER_KEY, JSON.stringify(response.user));
      }
    } catch (err: any) {
      // Re-throw so login screen can display the error message
      if (__DEV__) {
        console.log('[Auth] login failed — API URL:', api.baseUrl, '| Error:', err?.message);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    setIsLoading(true);
    try {
      const response = await api.register(payload);
      setToken(response.token);
      setUser(response.user);
      api.setTokens(response.token, response.refreshToken || null);

      await setStoredItem(TOKEN_KEY, response.token);
      if (response.refreshToken) {
        await setStoredItem(REFRESH_TOKEN_KEY, response.refreshToken);
      }
      await setStoredItem(USER_KEY, JSON.stringify(response.user));
    } catch (err: any) {
      // Re-throw so register screen can display the error message
      if (__DEV__) {
        console.log('[Auth] register failed — API URL:', api.baseUrl, '| Error:', err?.message);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      setToken(null);
      setUser(null);
      api.setTokens(null, null);
      await removeStoredItem(TOKEN_KEY);
      await removeStoredItem(REFRESH_TOKEN_KEY);
      await removeStoredItem(USER_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateUser = useCallback(async (updates: UpdateProfilePayload) => {
    if (!token) throw new Error('Utilisateur non authentifié');
    const updatedUser = await api.updateProfile(token, updates);
    setUser(updatedUser);
    await setStoredItem(USER_KEY, JSON.stringify(updatedUser));
  }, [token]);

  const changePassword = useCallback(async (payload: ChangePasswordPayload) => {
    if (!token) throw new Error('Utilisateur non authentifié');
    await api.changePassword(token, payload);
  }, [token]);

  const uploadPhoto = useCallback(async (imageUri: string) => {
    if (!token) throw new Error('Utilisateur non authentifié');
    const updatedUser = await api.uploadPhoto(token, imageUri);
    setUser(updatedUser);
    await setStoredItem(USER_KEY, JSON.stringify(updatedUser));
  }, [token]);

  const deletePhoto = useCallback(async () => {
    if (!token) throw new Error('Utilisateur non authentifié');
    const updatedUser = await api.deletePhoto(token);
    setUser(updatedUser);
    await setStoredItem(USER_KEY, JSON.stringify(updatedUser));
  }, [token]);

  const submitRoleRequest = useCallback(async (roleId: number): Promise<RoleRequest> => {
    if (!token) throw new Error('Utilisateur non authentifié');
    const res = await api.submitRoleRequest(token, roleId);
    
    // Update user state with the new role_request
    setUser((prevUser) => {
      if (!prevUser) return prevUser;
      const freshUser = {
        ...prevUser,
        role_request: res.role_request,
      };
      setStoredItem(USER_KEY, JSON.stringify(freshUser));
      return freshUser;
    });
    return res.role_request;
  }, [token]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const freshUser = await api.getCurrentUser(token);
      setUser((prevUser) => {
        if (JSON.stringify(prevUser) === JSON.stringify(freshUser)) {
          return prevUser;
        }
        setStoredItem(USER_KEY, JSON.stringify(freshUser));
        return freshUser;
      });
    } catch (err) {
      console.warn('Failed to refresh user profile:', err);
    }
  }, [token]);

  const contextValue = React.useMemo(() => ({
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    updateUser,
    changePassword,
    uploadPhoto,
    deletePhoto,
    submitRoleRequest,
    refreshUser,
  }), [
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    updateUser,
    changePassword,
    uploadPhoto,
    deletePhoto,
    submitRoleRequest,
    refreshUser,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

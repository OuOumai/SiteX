import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/services/api';

const SiteXIcon = require('@/assets/images/sitex-icon-master.png');

import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});

  const validate = () => {
    const newErrors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      newErrors.email = 'Veuillez saisir votre adresse email';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Adresse email invalide';
    }

    if (!password) {
      newErrors.password = 'Veuillez saisir votre mot de passe';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;

    setIsLoading(true);
    setErrors({});
    try {
      await login({ email, mot_de_passe: password });
      // Navigation will be automatically handled by root layout auth guard
    } catch (err: any) {
      const code = err?.data?.code || err?.code;
      const msg = (err?.data?.message || err?.data?.error || err?.message || '').toLowerCase();

      const isPasswordWrong =
        code === 'INVALID_PASSWORD' ||
        msg.includes('mot de passe incorrect') ||
        msg.includes('password is wrong') ||
        msg.includes('wrong password') ||
        msg.includes('incorrect password');

      if (isPasswordWrong) {
        setErrors({
          password: 'Password is wrong / Mot de passe incorrect',
          general: 'Password is wrong. Please check your password and try again.',
        });
      } else if (code === 'USER_NOT_FOUND' || msg.includes('aucun compte') || msg.includes('user not found')) {
        setErrors({
          email: 'Account not found / Aucun compte associé',
          general: 'Account not found. Please check your email address.',
        });
      } else {
        setErrors({
          general: err?.data?.message || err?.message || 'Échec de la connexion. Vérifiez vos identifiants.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    Alert.alert('Sign in with Google', 'Google OAuth integration ready for production configuration.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
        {/* Branding */}
        <View style={styles.header}>
          <Image source={SiteXIcon} style={styles.logoImage} resizeMode="contain" />
          <Text variant="h1" align="center" style={styles.title}>
            Sign In
          </Text>
          <Text variant="subtitle" align="center" style={styles.subtitle}>
            Construction Monitoring & Field Operations
          </Text>
        </View>

        {/* Card Form */}
        <Card variant="elevated" style={styles.card}>
        {/* DEV: API URL banner so network issues are immediately visible on phone */}
          {__DEV__ ? (
            <View style={styles.devBanner}>
              <Ionicons name="server-outline" size={12} color="#888" />
              <Text style={styles.devBannerText}>{api.baseUrl}</Text>
            </View>
          ) : null}

          {errors.general ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={Palette.alert} />
              <Text variant="error" style={styles.errorBannerText}>
                {errors.general}
              </Text>
            </View>
          ) : null}

          <Input
            label="Email Address"
            placeholder="agent@sitex.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={(val) => {
              setEmail(val);
              if (errors.email || errors.general) {
                setErrors((prev) => ({ ...prev, email: undefined, general: undefined }));
              }
            }}
            error={errors.email}
            leftIcon={<Ionicons name="mail-outline" size={20} color={Palette.textMuted} />}
          />

          <Input
            label="Password"
            placeholder="••••••••"
            isPassword
            value={password}
            onChangeText={(val) => {
              setPassword(val);
              if (errors.password || errors.general) {
                setErrors((prev) => ({ ...prev, password: undefined, general: undefined }));
              }
            }}
            error={errors.password}
            leftIcon={<Ionicons name="lock-closed-outline" size={20} color={Palette.textMuted} />}
          />

          <TouchableOpacity
            onPress={() => router.push('/(auth)/forgot-password')}
            style={styles.forgotContainer}
          >
            <Text style={styles.forgotText} weight="medium">
              Forgot password?
            </Text>
          </TouchableOpacity>

          <Button
            title="Sign in"
            variant="primary"
            size="lg"
            loading={isLoading}
            onPress={handleLogin}
            style={styles.submitBtn}
          />

          {/* Social Sign-in Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text variant="muted" style={styles.dividerText}>
              or
            </Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Google Sign In Option */}
          <Button
            title="Sign in with Google"
            variant="google"
            size="md"
            onPress={handleGoogleSignIn}
            icon={<Ionicons name="logo-google" size={18} color="#EA4335" />}
          />
        </Card>

        {/* Footer Link to Register */}
        <View style={styles.footer}>
          <Text variant="subtitle">Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.signUpLink} weight="bold">
              Sign up
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: 140,
    height: 140,
    marginBottom: 12,
    borderRadius: 28,
  },
  title: {
    marginTop: 4,
    color: Palette.text,
  },
  subtitle: {
    marginTop: 4,
    color: Palette.textMuted,
  },
  card: {
    marginTop: 6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.alertBg,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    marginTop: 0,
    flex: 1,
  },
  forgotContainer: {
    alignSelf: 'flex-end',
    marginBottom: 20,
    marginTop: -4,
  },
  forgotText: {
    color: Palette.primary,
    fontSize: 14,
  },
  submitBtn: {
    marginBottom: 16,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Palette.border,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  signUpLink: {
    color: Palette.primary,
    fontSize: 15,
  },
  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.04)',
    padding: 6,
    borderRadius: 6,
    marginBottom: 12,
  },
  devBannerText: {
    fontSize: 10,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
  },
});

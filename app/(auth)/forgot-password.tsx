import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

import { SafeAreaView } from 'react-native-safe-area-context';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSent, setIsSent] = useState(false);

  const handleResetPassword = () => {
    if (!email.trim()) {
      setError('Veuillez saisir votre adresse email');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Adresse email invalide');
      return;
    }

    setError('');
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setIsSent(true);
    }, 1000);
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
        >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Palette.text} />
        </TouchableOpacity>

        <View style={styles.iconHeader}>
          <View style={styles.iconCircle}>
            <Ionicons name="key-outline" size={32} color={Palette.primary} />
          </View>
          <Text variant="h1" align="center" style={styles.title}>
            Forgot password?
          </Text>
          <Text variant="subtitle" align="center" style={styles.subtitle}>
            Enter your account email below to receive password reset instructions.
          </Text>
        </View>

        <Card variant="elevated" style={styles.card}>
          {isSent ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle-outline" size={48} color={Palette.success} />
              <Text variant="h3" align="center" style={styles.successTitle}>
                Check your email
              </Text>
              <Text variant="muted" align="center" style={styles.successMsg}>
                We have sent reset instructions to {'\n'}
                <Text weight="bold">{email}</Text>
              </Text>
              <Button
                title="Back to Sign in"
                variant="primary"
                size="md"
                onPress={() => router.push('/(auth)/login')}
                style={styles.backToLoginBtn}
              />
            </View>
          ) : (
            <>
              <Input
                label="Email Address"
                placeholder="agent@sitex.com"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                error={error}
                leftIcon={<Ionicons name="mail-outline" size={20} color={Palette.textMuted} />}
              />

              <Button
                title="Reset password"
                variant="primary"
                size="lg"
                loading={isLoading}
                onPress={handleResetPassword}
                style={styles.submitBtn}
              />
            </>
          )}
        </Card>

        <View style={styles.footer}>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')} style={styles.backLinkRow}>
            <Ionicons name="arrow-back-outline" size={16} color={Palette.primary} />
            <Text style={styles.backLinkText} weight="semibold">
              Back to Sign in
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  iconHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: Palette.text,
  },
  subtitle: {
    marginTop: 8,
    maxWidth: 280,
  },
  card: {
    marginTop: 4,
  },
  submitBtn: {
    marginTop: 12,
  },
  successBox: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  successTitle: {
    marginTop: 12,
    color: Palette.text,
  },
  successMsg: {
    marginTop: 8,
    marginBottom: 20,
  },
  backToLoginBtn: {
    width: '100%',
  },
  footer: {
    alignItems: 'center',
    marginTop: 28,
  },
  backLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLinkText: {
    color: Palette.primary,
    fontSize: 15,
  },
});

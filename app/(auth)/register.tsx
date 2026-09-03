import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
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

const SiteXIcon = require('@/assets/images/sitex-icon-master.png');

import { SafeAreaView } from 'react-native-safe-area-context';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();

  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    nom?: string;
    prenom?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    general?: string;
  }>({});

  const validate = () => {
    const newErrors: typeof errors = {};

    if (!nom.trim()) {
      newErrors.nom = 'Le nom est requis';
    }
    if (!prenom.trim()) {
      newErrors.prenom = 'Le prénom est requis';
    }
    if (!email.trim()) {
      newErrors.email = "L'adresse email est requise";
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Adresse email invalide';
    }
    if (!password) {
      newErrors.password = 'Le mot de passe est requis';
    } else if (password.length < 6) {
      newErrors.password = 'Le mot de passe doit contenir au moins 6 caractères';
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Veuillez confirmer le mot de passe';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Les mots de passe ne correspondent pas';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;

    setIsLoading(true);
    setErrors({});
    try {
      await register({
        nom,
        prenom,
        email,
        mot_de_passe: password,
      });
      // Router redirection is handled automatically by root layout auth guard
    } catch (err: any) {
      setErrors({
        general: err.message || "Erreur lors de la création du compte.",
      });
    } finally {
      setIsLoading(false);
    }
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
        {/* Header */}
        <View style={styles.header}>
          {/* PNG logo */}
          <Image source={SiteXIcon} style={styles.logoImage} resizeMode="contain" />
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={Palette.text} />
          </TouchableOpacity>
          <Text variant="h1" style={styles.title}>
            Créer un compte
          </Text>
          <Text variant="subtitle" style={styles.subtitle}>
            Rejoignez SiteX pour la surveillance de chantiers en temps réel
          </Text>
        </View>

        {/* Card Form */}
        <Card variant="elevated" style={styles.card}>
          {errors.general ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={Palette.alert} />
              <Text variant="error" style={styles.errorBannerText}>
                {errors.general}
              </Text>
            </View>
          ) : null}

          <View style={styles.nameRow}>
            <View style={styles.halfWidth}>
              <Input
                label="Prénom"
                placeholder="Jean"
                value={prenom}
                onChangeText={setPrenom}
                error={errors.prenom}
                leftIcon={<Ionicons name="person-outline" size={18} color={Palette.textMuted} />}
              />
            </View>

            <View style={styles.halfWidth}>
              <Input
                label="Nom"
                placeholder="Dupont"
                value={nom}
                onChangeText={setNom}
                error={errors.nom}
                leftIcon={<Ionicons name="person-outline" size={18} color={Palette.textMuted} />}
              />
            </View>
          </View>

          <Input
            label="Email"
            placeholder="jean.dupont@sitex.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            leftIcon={<Ionicons name="mail-outline" size={20} color={Palette.textMuted} />}
          />

          <Input
            label="Mot de passe"
            placeholder="••••••••"
            isPassword
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            leftIcon={<Ionicons name="lock-closed-outline" size={20} color={Palette.textMuted} />}
          />

          <Input
            label="Confirmer le mot de passe"
            placeholder="••••••••"
            isPassword
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={errors.confirmPassword}
            leftIcon={<Ionicons name="lock-closed-outline" size={20} color={Palette.textMuted} />}
          />

          <Button
            title="Créer mon compte"
            variant="primary"
            size="lg"
            loading={isLoading}
            onPress={handleRegister}
            style={styles.submitBtn}
          />
        </Card>

        {/* Footer Link to Login */}
        <View style={styles.footer}>
          <Text variant="subtitle">Déjà inscrit ? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.signInLink} weight="bold">
              Se connecter
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
    marginBottom: 20,
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  title: {
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
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfWidth: {
    flex: 1,
  },
  submitBtn: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  signInLink: {
    color: Palette.primary,
    fontSize: 15,
  },
});

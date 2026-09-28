import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Palette, Roles } from '@/constants/theme';
import { api } from '@/services/api';
import { DatePickerModal } from '@/components/ui/date-picker-modal';
import { PhoneInput } from '@/components/ui/phone-input';
import { AddressAutocompleteInput } from '@/components/ui/address-autocomplete-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SiteXHeader } from '@/components/navigation/SiteXHeader';

// ─── Option Constants ────────────────────────────────────────────────────────

const PROFESSION_OPTIONS = [
  'Ingénieur Géomatique',
  'Ingénieur Génie Civil',
  'Ingénieur Topographe',
  'Ingénieur Cartographe',
  'Ingénieur SIG / GIS',
  'Ingénieur en Télédétection',
  'Ingénieur Urbaniste',
  'Architecte',
  'Géomètre-Topographe',
  'Technicien Topographe',
  'Technicien SIG',
  'Conducteur de Travaux',
  'Chef de Projet',
  'Responsable de Projet',
  'Responsable Technique',
  'Responsable HSE',
  'Responsable Foncier',
  'Architecte Paysagiste',
  'Urbaniste',
  'Géomaticien',
  'Cartographe',
  'Analyste SIG',
  'Analyste en Télédétection',
  'Développeur SIG',
  'Consultant',
  'Administrateur SIG',
  'Autre',
];

const ENTREPRISE_OPTIONS = [
  "Bureau d'Études",
  'Entreprise de BTP',
  'Cabinet de Géomètre-Topographe',
  "Bureau d'Architecture",
  "Société d'Ingénierie",
  'Entreprise de Construction',
  'Promoteur Immobilier',
  'Collectivité Territoriale',
  'Commune',
  'Agence Urbaine',
  'Administration Publique',
  'Société de Topographie',
  'Société de Géomatique / SIG',
  'Entreprise de Télédétection',
  'Entreprise de Cartographie',
  "Bureau d'Études Techniques (BET)",
  'Laboratoire de Recherche',
  'Université / Établissement d’Enseignement',
  'ONG / Association',
  'Autre',
];

const POSTE_OPTIONS = [
  'Chef de Projet',
  'Chef de Projet Chantier',
  'Conducteur de Travaux',
  'Directeur de Projet',
  'Responsable de Projet',
  'Responsable Technique',
  'Responsable Travaux',
  'Ingénieur Travaux',
  'Ingénieur Génie Civil',
  'Ingénieur Géomatique',
  'Ingénieur SIG',
  'Ingénieur Topographe',
  'Géomètre-Topographe',
  'Technicien Topographe',
  'Technicien SIG',
  'Géomaticien',
  'Cartographe',
  'Analyste SIG',
  'Analyste Télédétection',
  'Architecte',
  'Urbaniste',
  'Responsable HSE',
  'Responsable Qualité',
  'Responsable Foncier',
  'Consultant',
  'Stagiaire',
  'Étudiant',
  'Autre',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDisplayDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parts[0];
      const m = parts[1];
      const d = parts[2];
      const monthNames = [
        'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
      ];
      const mIdx = parseInt(m, 10) - 1;
      const monthName = monthNames[mIdx] ?? m;
      return `${parseInt(d, 10)} ${monthName} ${y}`;
    }
  }
  return dateStr;
}

function getRoleLabel(roleId?: number, roleNom?: string): string {
  if (roleNom) {
    if (roleNom === 'AgentTerrain') return 'Agent Terrain';
    if (roleNom === 'Responsable') return 'Responsable de Projet';
    return roleNom;
  }
  if (!roleId) return 'Non attribué';
  switch (roleId) {
    case 1:
      return 'Administrateur';
    case 2:
      return 'Responsable de Projet';
    case 3:
      return 'Agent Terrain';
    case 4:
      return 'Client';
    default:
      return `Rôle #${roleId}`;
  }
}

function getRoleDescription(roleId?: number, roleNom?: string): string {
  const effectiveNom = roleNom || (roleId === 1 ? 'Administrateur' : roleId === 2 ? 'Responsable' : roleId === 3 ? 'AgentTerrain' : roleId === 4 ? 'Client' : '');
  switch (effectiveNom) {
    case 'Administrateur':
      return 'Gestion et supervision complète de la plateforme';
    case 'Responsable':
      return 'Création et gestion des projets, chantiers et tronçons';
    case 'AgentTerrain':
    case 'Agent Terrain':
      return 'Collecte et remontée des observations terrain, GPS et photos';
    case 'Client':
      return 'Consultation des projets, chantiers, cartes et rapports';
    default:
      return '';
  }
}

function getFullPhotoUrl(photoUrl?: string | null): string | null {
  if (!photoUrl) return null;
  if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://') || photoUrl.startsWith('data:')) {
    return photoUrl;
  }
  return `${api.baseUrl}${photoUrl}`;
}

// ─── Avatar Component ────────────────────────────────────────────────────────

interface AvatarProps {
  nom?: string;
  prenom?: string;
  photoUrl?: string | null;
  size?: number;
  onEditPress?: () => void;
  isLoading?: boolean;
}

function Avatar({ nom, prenom, photoUrl, size = 80, onEditPress, isLoading }: AvatarProps) {
  const fullUrl = getFullPhotoUrl(photoUrl);
  const initials = `${prenom?.[0] ?? ''}${nom?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <View style={{ position: 'relative', width: size, height: size }}>
      {fullUrl ? (
        <Image
          source={{ uri: fullUrl }}
          resizeMode="cover"
          style={[styles.avatarImage, { width: size, height: size, borderRadius: size / 2 }]}
        />
      ) : (
        <View
          style={[
            styles.avatar,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[styles.avatarText, { fontSize: size * 0.32 }]} weight="bold">
            {initials}
          </Text>
        </View>
      )}

      {isLoading && (
        <View style={[styles.avatarLoadingOverlay, { borderRadius: size / 2 }]}>
          <ActivityIndicator color="#FFFFFF" size="small" />
        </View>
      )}

      {onEditPress && (
        <TouchableOpacity
          style={styles.avatarEditBadge}
          activeOpacity={0.8}
          onPress={onEditPress}
        >
          <Ionicons name="camera-outline" size={14} color="#FFFFFF" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Edit Profile Modal ───────────────────────────────────────────────────────

interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

function EditProfileModal({ visible, onClose }: EditProfileModalProps) {
  const { user, updateUser, changePassword, uploadPhoto, deletePhoto } = useAuth();

  // Identité
  const [nom, setNom] = useState(user?.nom ?? '');
  const [prenom, setPrenom] = useState(user?.prenom ?? '');
  const [dateNaissance, setDateNaissance] = useState(user?.date_naissance ?? '');

  // Contact
  const [email, setEmail] = useState(user?.email ?? '');
  const [telephone, setTelephone] = useState(user?.telephone ?? '');
  const [adresse, setAdresse] = useState(user?.adresse ?? '');
  const [ville, setVille] = useState(user?.ville ?? '');

  // Informations professionnelles
  const [profession, setProfession] = useState(user?.profession ?? '');
  const [entreprise, setEntreprise] = useState(user?.entreprise ?? '');
  const [poste, setPoste] = useState(user?.poste ?? '');
  const [numeroPro, setNumeroPro] = useState(user?.numero_pro ?? '');

  // Localisation professionnelle
  const [villePro, setVillePro] = useState(user?.ville_pro ?? '');
  const [regionPro, setRegionPro] = useState(user?.region_pro ?? '');
  const [adressePro, setAdressePro] = useState(user?.adresse_pro ?? '');

  // Sécurité (Password)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Geoinformation coordinates & extra address fields
  const [latitude, setLatitude] = useState<number | null>(user?.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(user?.longitude ?? null);
  const [codePostal, setCodePostal] = useState<string>(user?.code_postal ?? '');
  const [pays, setPays] = useState<string>(user?.pays ?? '');

  // Professional Geoinformation coordinates & extra address fields
  const [latitudePro, setLatitudePro] = useState<number | null>(user?.latitude_pro ?? null);
  const [longitudePro, setLongitudePro] = useState<number | null>(user?.longitude_pro ?? null);
  const [paysPro, setPaysPro] = useState<string>(user?.pays_pro ?? '');
  const [isRegionAutoPopulated, setIsRegionAutoPopulated] = useState<boolean>(false);

  // Loading & Feedback states
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);

  useEffect(() => {
    if (visible && user) {
      setNom(user.nom ?? '');
      setPrenom(user.prenom ?? '');
      setDateNaissance(user.date_naissance ?? '');
      setEmail(user.email ?? '');
      setTelephone(user.telephone ?? '');
      setAdresse(user.adresse ?? '');
      setVille(user.ville ?? '');
      setProfession(user.profession ?? '');
      setEntreprise(user.entreprise ?? '');
      setPoste(user.poste ?? '');
      setNumeroPro(user.numero_pro ?? '');
      setVillePro(user.ville_pro ?? '');
      setRegionPro(user.region_pro ?? '');
      setAdressePro(user.adresse_pro ?? '');
      setLatitude(user.latitude ?? null);
      setLongitude(user.longitude ?? null);
      setCodePostal(user.code_postal ?? '');
      setPays(user.pays ?? '');
      setLatitudePro(user.latitude_pro ?? null);
      setLongitudePro(user.longitude_pro ?? null);
      setPaysPro(user.pays_pro ?? '');
      setIsRegionAutoPopulated(Boolean(user.region_pro));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setProfileError(null);
      setPasswordError(null);
      setPasswordSuccess(null);
    }
  }, [visible, user]);

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission requise', 'Accès à la galerie requis pour changer la photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUploadingPhoto(true);
        setProfileError(null);
        const photoData = result.assets[0].base64
          ? `data:image/jpeg;base64,${result.assets[0].base64}`
          : result.assets[0].uri;
        await uploadPhoto(photoData);
      }
    } catch (err: any) {
      setProfileError(err.message ?? 'Erreur lors du téléversement de la photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!nom.trim() || !prenom.trim() || !email.trim()) {
      setProfileError('Nom, prénom et email sont requis.');
      return;
    }

    if (telephone && telephone.trim().length > 0) {
      const digitsOnly = telephone.replace(/\D/g, '');
      if (digitsOnly.length < 6) {
        setProfileError('Veuillez saisir un numéro de téléphone valide.');
        return;
      }
    }

    setIsSavingProfile(true);
    setProfileError(null);

    try {
      await updateUser({
        nom: nom.trim(),
        prenom: prenom.trim(),
        email: email.trim(),
        date_naissance: dateNaissance.trim(),
        telephone: telephone.trim(),
        adresse: adresse.trim(),
        ville: ville.trim(),
        profession: profession.trim(),
        entreprise: entreprise.trim(),
        poste: poste.trim(),
        numero_pro: numeroPro.trim(),
        ville_pro: villePro.trim(),
        region_pro: regionPro.trim(),
        adresse_pro: adressePro.trim(),
        latitude,
        longitude,
        code_postal: codePostal.trim(),
        pays: pays.trim(),
        latitude_pro: latitudePro,
        longitude_pro: longitudePro,
        pays_pro: paysPro.trim(),
      });
      onClose();
    } catch (err: any) {
      setProfileError(err.message ?? 'Erreur lors de la mise à jour du profil.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Veuillez remplir tous les champs du mot de passe.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Le nouveau mot de passe et sa confirmation ne correspondent pas.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    setIsChangingPassword(true);

    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordSuccess('Mot de passe modifié avec succès !');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.message ?? 'Erreur lors de la modification du mot de passe.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalContainer}
      >
        {/* Modal header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <Ionicons name="close" size={22} color={Palette.text} />
          </TouchableOpacity>
          <Text variant="h2" style={styles.modalTitle}>
            Modifier le profil
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.modalContent}
          keyboardShouldPersistTaps="handled"
        >
          {profileError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Palette.alert} />
              <Text variant="error" style={{ flex: 1 }}>
                {profileError}
              </Text>
            </View>
          ) : null}

          {/* ── PHOTO DE PROFIL ── */}
          <View style={styles.photoPickerContainer}>
            <Avatar
              nom={user?.nom}
              prenom={user?.prenom}
              photoUrl={user?.photo_url}
              size={90}
              onEditPress={handlePickImage}
              isLoading={isUploadingPhoto}
            />
            <TouchableOpacity onPress={handlePickImage} disabled={isUploadingPhoto} style={{ marginTop: 10 }}>
              <Text style={{ color: Palette.primary, fontSize: 13 }} weight="semibold">
                {isUploadingPhoto ? 'Téléversement en cours...' : 'Modifier la photo de profil'}
              </Text>
            </TouchableOpacity>
            {user?.photo_url && (
              <TouchableOpacity
                onPress={async () => {
                  try {
                    await deletePhoto();
                    setProfileError(null);
                  } catch (err: any) {
                    setProfileError(err.message ?? 'Erreur lors de la suppression.');
                  }
                }}
                disabled={isUploadingPhoto}
                style={{ marginTop: 8 }}
              >
                <Text style={{ color: Palette.alert, fontSize: 13 }} weight="semibold">
                  Supprimer la photo
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── IDENTITÉ ── */}
          <Text style={styles.modalSectionHeader} weight="semibold">
            IDENTITÉ
          </Text>
          <Input
            label="Prénom"
            value={prenom}
            onChangeText={setPrenom}
            leftIcon={<Ionicons name="person-outline" size={18} color={Palette.textMuted} />}
          />
          <Input
            label="Nom"
            value={nom}
            onChangeText={setNom}
            leftIcon={<Ionicons name="person-outline" size={18} color={Palette.textMuted} />}
          />
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setIsDatePickerVisible(true)}
          >
            <Input
              label="Date de naissance"
              value={formatDisplayDate(dateNaissance)}
              placeholder="Sélectionnez votre date de naissance"
              editable={false}
              pointerEvents="none"
              leftIcon={<Ionicons name="calendar-outline" size={18} color={Palette.primary} />}
              rightIcon={<Ionicons name="chevron-down-outline" size={18} color={Palette.textMuted} />}
            />
          </TouchableOpacity>

          <DatePickerModal
            visible={isDatePickerVisible}
            initialValue={dateNaissance}
            onClose={() => setIsDatePickerVisible(false)}
            onConfirm={(selectedDate) => setDateNaissance(selectedDate)}
          />

          {/* ── CONTACT ── */}
          <Text style={styles.modalSectionHeader} weight="semibold">
            CONTACT
          </Text>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon={<Ionicons name="mail-outline" size={18} color={Palette.textMuted} />}
          />
          <PhoneInput
            label="Téléphone"
            value={telephone}
            onChangePhone={setTelephone}
          />
          <AddressAutocompleteInput
            label="Adresse"
            value={adresse}
            onChangeText={setAdresse}
            onSelectAddress={(details) => {
              setAdresse(details.adresse);
              if (details.ville) setVille(details.ville);
              if (details.code_postal) setCodePostal(details.code_postal);
              if (details.pays) setPays(details.pays);
              if (details.latitude !== undefined) setLatitude(details.latitude);
              if (details.longitude !== undefined) setLongitude(details.longitude);
            }}
          />
          <Input
            label="Ville"
            value={ville}
            onChangeText={setVille}
            leftIcon={<Ionicons name="business-outline" size={18} color={Palette.textMuted} />}
          />

          {/* ── INFORMATIONS PROFESSIONNELLES ── */}
          <Text style={styles.modalSectionHeader} weight="semibold">
            INFORMATIONS PROFESSIONNELLES
          </Text>
          <SearchableSelect
            label="Profession / Fonction"
            value={profession}
            onChangeValue={setProfession}
            options={PROFESSION_OPTIONS}
            placeholder="Sélectionnez votre profession"
            customPlaceholder="Ex: Ingénieur en Géoinformatique"
            leftIcon={<Ionicons name="briefcase-outline" size={18} color={Palette.primary} />}
          />
          <SearchableSelect
            label="Entreprise / Organisme"
            value={entreprise}
            onChangeValue={setEntreprise}
            options={ENTREPRISE_OPTIONS}
            placeholder="Sélectionnez votre organisme"
            customPlaceholder="Ex: GeoInfo Consult SARL"
            leftIcon={<Ionicons name="business-outline" size={18} color={Palette.primary} />}
          />
          <SearchableSelect
            label="Poste"
            value={poste}
            onChangeValue={setPoste}
            options={POSTE_OPTIONS}
            placeholder="Sélectionnez votre poste"
            customPlaceholder="Ex: Responsable SIG & Cartographie"
            leftIcon={<Ionicons name="card-outline" size={18} color={Palette.primary} />}
          />
          <Input
            label="Numéro professionnel (optionnel)"
            value={numeroPro}
            onChangeText={setNumeroPro}
            placeholder="Ex: PRO-8921"
            leftIcon={<Ionicons name="card-outline" size={18} color={Palette.textMuted} />}
          />

          {/* ── LOCALISATION PROFESSIONNELLE ── */}
          <Text style={styles.modalSectionHeader} weight="semibold">
            LOCALISATION PROFESSIONNELLE
          </Text>
          <AddressAutocompleteInput
            label="Ville professionnelle"
            value={villePro}
            placeholder="Ex: Rabat, Casablanca..."
            typeFilter="city"
            onChangeText={(text) => {
              setVillePro(text);
              if (!text) setIsRegionAutoPopulated(false);
            }}
            onSelectAddress={(details) => {
              if (details.ville) setVillePro(details.ville);
              if (details.region) {
                setRegionPro(details.region);
                setIsRegionAutoPopulated(true);
              }
              if (details.pays) setPaysPro(details.pays);
              if (details.latitude !== undefined) setLatitudePro(details.latitude);
              if (details.longitude !== undefined) setLongitudePro(details.longitude);
            }}
          />

          <View style={{ marginBottom: 4 }}>
            <Input
              label="Région professionnelle"
              value={regionPro}
              onChangeText={(text) => {
                setRegionPro(text);
                setIsRegionAutoPopulated(false);
              }}
              placeholder="Ex: Rabat-Salé-Kénitra"
              leftIcon={<Ionicons name="compass-outline" size={18} color={Palette.primary} />}
            />
            {isRegionAutoPopulated && regionPro ? (
              <View style={styles.autoPopulatedBadge}>
                <Ionicons name="checkmark-circle" size={13} color={Palette.primary} />
                <Text style={styles.autoPopulatedText} weight="medium">
                  Région automatiquement identifiée via Geoapify
                </Text>
              </View>
            ) : null}
          </View>

          <AddressAutocompleteInput
            label="Adresse professionnelle"
            value={adressePro}
            placeholder="Ex: Avenue Mohammed V, Zone Industrielle..."
            typeFilter="all"
            onChangeText={setAdressePro}
            onSelectAddress={(details) => {
              setAdressePro(details.adresse);
              if (details.ville) setVillePro(details.ville);
              if (details.region) {
                setRegionPro(details.region);
                setIsRegionAutoPopulated(true);
              }
              if (details.pays) setPaysPro(details.pays);
              if (details.latitude !== undefined) setLatitudePro(details.latitude);
              if (details.longitude !== undefined) setLongitudePro(details.longitude);
            }}
          />

          <Button
            title="Enregistrer les modifications"
            variant="primary"
            size="lg"
            loading={isSavingProfile}
            onPress={handleSaveProfile}
            style={{ marginTop: 12, marginBottom: 24 }}
          />

          {/* ── SÉCURITÉ ── */}
          <View style={styles.securityDivider} />
          <Text style={styles.modalSectionHeader} weight="semibold">
            SÉCURITÉ — MODIFIER LE MOT DE PASSE
          </Text>

          {passwordError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Palette.alert} />
              <Text variant="error" style={{ flex: 1 }}>
                {passwordError}
              </Text>
            </View>
          ) : null}

          {passwordSuccess ? (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle-outline" size={16} color={Palette.success} />
              <Text style={{ color: Palette.success, flex: 1, fontSize: 13 }}>
                {passwordSuccess}
              </Text>
            </View>
          ) : null}

          <Input
            label="Mot de passe actuel"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Palette.textMuted} />}
          />
          <Input
            label="Nouveau mot de passe"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            leftIcon={<Ionicons name="key-outline" size={18} color={Palette.textMuted} />}
          />
          <Input
            label="Confirmer le nouveau mot de passe"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            leftIcon={<Ionicons name="key-outline" size={18} color={Palette.textMuted} />}
          />

          <Button
            title="Modifier le mot de passe"
            variant="outline"
            size="md"
            loading={isChangingPassword}
            onPress={handleChangePassword}
            style={{ marginTop: 8, marginBottom: 30 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Role Request Options ─────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  {
    id: 2,
    nom: 'Responsable de Projet',
    icon: 'briefcase-outline' as const,
    description: 'Superviser l’avancement des projets et gérer la planification des chantiers.',
  },
  {
    id: 3,
    nom: 'Agent de Terrain',
    icon: 'construct-outline' as const,
    description: 'Saisir les données terrain, ajouter des photos et signaler les anomalies.',
  },
  {
    id: 4,
    nom: 'Client',
    icon: 'person-circle-outline' as const,
    description: 'Suivre l’évolution des projets et soumettre des réclamations.',
  },
];

// ─── Profile Screen ───────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, logout, submitRoleRequest, uploadPhoto, deletePhoto, refreshUser } = useAuth();
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [isSubmittingRole, setIsSubmittingRole] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Auto-refresh profile and latest role status on focus
  useFocusEffect(
    useCallback(() => {
      refreshUser();
    }, [refreshUser])
  );

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Voulez-vous vraiment vous déconnecter ?')) {
        logout();
      }
      return;
    }

    Alert.alert(
      'Déconnexion',
      'Voulez-vous vraiment vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se déconnecter',
          style: 'destructive',
          onPress: () => logout(),
        },
      ]
    );
  };

  const handlePickPhotoDirectly = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission requise', 'Accès à la galerie requis.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUploadingPhoto(true);
        const photoData = result.assets[0].base64
          ? `data:image/jpeg;base64,${result.assets[0].base64}`
          : result.assets[0].uri;
        await uploadPhoto(photoData);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err.message ?? 'Erreur lors du téléversement de la photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSubmitRoleRequest = async () => {
    if (!selectedRoleId) {
      Alert.alert('Sélection requise', 'Veuillez sélectionner un profil souhaité.');
      return;
    }

    setIsSubmittingRole(true);
    try {
      await submitRoleRequest(selectedRoleId);
      Alert.alert('Demande envoyée', 'Votre demande de rôle a été soumise avec succès.');
    } catch (err: any) {
      Alert.alert('Erreur', err.message ?? 'Impossible d’envoyer la demande.');
    } finally {
      setIsSubmittingRole(false);
    }
  };

  const activeRoleRequest = user?.role_request;

  const memberSince = user?.date_creation
    ? new Date(user.date_creation).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── Global SiteX Header ── */}
      <SiteXHeader
        title="Profil"
        rightContent={
          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={handleLogout}
            activeOpacity={0.7}
            accessibilityLabel="Se déconnecter"
          >
            <Ionicons name="log-out-outline" size={20} color={Palette.alert} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Subtitle info ── */}
        <View style={styles.pageHeader}>
          <Text variant="subtitle" style={styles.pageSubtitle}>
            Gestion de votre compte et informations
          </Text>
        </View>

        {/* ── Hero card: avatar + identity ── */}
        <Card variant="elevated" style={styles.heroCard}>
          <View style={styles.heroContent}>
            <Avatar
              nom={user?.nom}
              prenom={user?.prenom}
              photoUrl={user?.photo_url}
              size={80}
              onEditPress={handlePickPhotoDirectly}
              isLoading={isUploadingPhoto}
            />

            <View style={styles.heroInfo}>
              <Text variant="h2" style={styles.heroName}>
                {user?.prenom} {user?.nom}
              </Text>
              <Text variant="subtitle" style={styles.heroEmail}>
                {user?.email}
              </Text>

              <View
                style={[
                  styles.statusBadge,
                  activeRoleRequest?.statut === 'PENDING'
                    ? styles.statusBadgePending
                    : user?.actif
                    ? styles.statusBadgeActive
                    : styles.statusBadgeInactive,
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    activeRoleRequest?.statut === 'PENDING'
                      ? styles.statusDotPending
                      : user?.actif
                      ? styles.statusDotActive
                      : styles.statusDotInactive,
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    activeRoleRequest?.statut === 'PENDING'
                      ? styles.statusTextPending
                      : user?.actif
                      ? styles.statusTextActive
                      : styles.statusTextInactive,
                  ]}
                  weight="semibold"
                >
                  {activeRoleRequest?.statut === 'PENDING'
                    ? `En attente : ${activeRoleRequest.role_nom || 'Validation'}`
                    : getRoleLabel(user?.role_id, user?.role_nom)}
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.editButton}
            activeOpacity={0.8}
            onPress={() => setEditModalVisible(true)}
          >
            <Ionicons name="pencil-outline" size={16} color={Palette.primary} />
            <Text style={styles.editButtonText} weight="semibold">
              Modifier le profil
            </Text>
          </TouchableOpacity>
        </Card>

        {/* ── 1. INFORMATIONS PERSONNELLES ── */}
        <Card variant="elevated" style={styles.section}>
          <Text style={styles.sectionTitle} weight="semibold">
            INFORMATIONS PERSONNELLES
          </Text>
          <InfoRow icon="person-outline" label="Prénom" value={user?.prenom} />
          <InfoRow icon="person-outline" label="Nom" value={user?.nom} />
          <InfoRow icon="calendar-outline" label="Date de naissance" value={formatDisplayDate(user?.date_naissance)} />
          {memberSince && (
            <InfoRow icon="time-outline" label="Membre depuis" value={memberSince} />
          )}
        </Card>

        {/* ── 2. CONTACT ── */}
        <Card variant="elevated" style={styles.section}>
          <Text style={styles.sectionTitle} weight="semibold">
            CONTACT
          </Text>
          <InfoRow icon="mail-outline" label="Email" value={user?.email} />
          <InfoRow icon="call-outline" label="Téléphone" value={user?.telephone} />
          <InfoRow icon="location-outline" label="Adresse" value={user?.adresse} />
          <InfoRow icon="business-outline" label="Ville" value={user?.ville} />
        </Card>

        {/* ── 3. INFORMATIONS PROFESSIONNELLES ── */}
        <Card variant="elevated" style={styles.section}>
          <Text style={styles.sectionTitle} weight="semibold">
            INFORMATIONS PROFESSIONNELLES
          </Text>
          <InfoRow icon="briefcase-outline" label="Profession / Fonction" value={user?.profession} />
          <InfoRow icon="business-outline" label="Entreprise / Organisme" value={user?.entreprise} />
          <InfoRow icon="card-outline" label="Poste" value={user?.poste} />
          <InfoRow icon="card-outline" label="Numéro professionnel" value={user?.numero_pro} />
        </Card>

        {/* ── 4. LOCALISATION PROFESSIONNELLE ── */}
        <Card variant="elevated" style={styles.section}>
          <Text style={styles.sectionTitle} weight="semibold">
            LOCALISATION PROFESSIONNELLE
          </Text>
          <InfoRow icon="map-outline" label="Ville professionnelle" value={user?.ville_pro} />
          <InfoRow icon="compass-outline" label="Région professionnelle" value={user?.region_pro} />
          <InfoRow icon="home-outline" label="Adresse professionnelle" value={user?.adresse_pro} />
        </Card>

        {/* ── 5. DEMANDE DE PROFIL (ROLE REQUEST) ── */}
        <Card variant="elevated" style={styles.section}>
          <Text style={styles.sectionTitle} weight="semibold">
            DEMANDE DE PROFIL
          </Text>

          <View style={styles.currentRoleBadgeContainer}>
            <Text style={{ fontSize: 13, color: Palette.textMuted }}>
              {activeRoleRequest?.statut === 'PENDING' ? 'Statut du profil :' : 'Rôle actuel sur la plateforme :'}
            </Text>
            <View style={styles.roleRow}>
              <View style={[styles.roleIconBg, activeRoleRequest?.statut === 'PENDING' && { backgroundColor: 'rgba(217, 119, 6, 0.1)' }]}>
                <Ionicons
                  name={activeRoleRequest?.statut === 'PENDING' ? 'time-outline' : 'shield-checkmark-outline'}
                  size={20}
                  color={activeRoleRequest?.statut === 'PENDING' ? '#D97706' : Palette.primary}
                />
              </View>
              <View style={styles.roleInfo}>
                <Text style={[styles.roleLabel, activeRoleRequest?.statut === 'PENDING' && { color: '#D97706' }]} weight="semibold">
                  {activeRoleRequest?.statut === 'PENDING'
                    ? `En attente de validation (${activeRoleRequest.role_nom || 'Profil'})`
                    : getRoleLabel(user?.role_id, user?.role_nom)}
                </Text>
                <Text variant="muted" style={styles.roleDescription}>
                  {activeRoleRequest?.statut === 'PENDING'
                    ? `Votre demande d'accès au profil « ${activeRoleRequest.role_nom} » est en cours d'examen par l'administrateur.`
                    : getRoleDescription(user?.role_id, user?.role_nom)}
                </Text>
              </View>
            </View>
          </View>

          {/* Status Display of Existing Request */}
          {activeRoleRequest && (
            <View style={styles.requestStatusBox}>
              <View style={styles.requestStatusHeader}>
                <Ionicons
                  name={
                    activeRoleRequest.statut === 'APPROVED'
                      ? 'checkmark-circle'
                      : activeRoleRequest.statut === 'REJECTED'
                      ? 'close-circle'
                      : 'time-outline'
                  }
                  size={18}
                  color={
                    activeRoleRequest.statut === 'APPROVED'
                      ? '#10B981'
                      : activeRoleRequest.statut === 'REJECTED'
                      ? Palette.alert
                      : Palette.primary
                  }
                />
                <Text style={{ fontSize: 13, color: Palette.text, flex: 1 }} weight="semibold">
                  {activeRoleRequest.statut === 'APPROVED'
                    ? `Profil ${activeRoleRequest.role_nom} validé`
                    : `Statut de la demande (${activeRoleRequest.role_nom})`}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    activeRoleRequest.statut === 'APPROVED' && styles.statusBadgeActive,
                    activeRoleRequest.statut === 'PENDING' && styles.statusBadgePending,
                    activeRoleRequest.statut === 'REJECTED' && styles.statusBadgeInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      activeRoleRequest.statut === 'APPROVED' && styles.statusTextActive,
                      activeRoleRequest.statut === 'PENDING' && styles.statusTextPending,
                      activeRoleRequest.statut === 'REJECTED' && styles.statusTextInactive,
                    ]}
                    weight="bold"
                  >
                    {activeRoleRequest.statut === 'APPROVED'
                      ? 'Validée'
                      : activeRoleRequest.statut === 'PENDING'
                      ? 'En attente'
                      : 'Refusée'}
                  </Text>
                </View>
              </View>

              <Text style={{ fontSize: 12, color: Palette.textMuted, marginTop: 4 }}>
                Demande transmise le {new Date(activeRoleRequest.date_demande).toLocaleDateString('fr-FR')}
              </Text>

              {activeRoleRequest.statut === 'APPROVED' && (
                <Text style={{ fontSize: 12, color: '#065F46', marginTop: 4, fontWeight: '500' }}>
                  Votre demande pour le rôle "{activeRoleRequest.role_nom}" a été approuvée par l'administrateur. Vos fonctionnalités associées sont actives.
                </Text>
              )}

              {activeRoleRequest.statut === 'PENDING' && (
                <Text style={{ fontSize: 12, color: Palette.secondary, marginTop: 4 }}>
                  Votre demande est en cours d'examen par un administrateur.
                </Text>
              )}

              {activeRoleRequest.statut === 'REJECTED' && (
                <Text style={{ fontSize: 12, color: Palette.alert, marginTop: 4 }}>
                  Votre demande précédente n'a pas été retenue. Vous pouvez soumettre une nouvelle demande ci-dessous.
                </Text>
              )}
            </View>
          )}

          <Text style={{ fontSize: 14, color: Palette.text, marginBottom: 12, marginTop: 8 }} weight="medium">
            {activeRoleRequest?.statut === 'APPROVED'
              ? 'Changer de profil ou soumettre une nouvelle demande :'
              : 'Quel profil souhaitez-vous avoir ?'}
          </Text>

          {/* Role Request Options */}
          {ROLE_OPTIONS.map((opt) => {
            const isSelected = selectedRoleId === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.roleOptionCard, isSelected && styles.roleOptionCardSelected]}
                activeOpacity={0.7}
                onPress={() => setSelectedRoleId(opt.id)}
              >
                <View style={styles.radioCircle}>
                  {isSelected && <View style={styles.radioInnerCircle} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleOptionTitle} weight="semibold">
                    {opt.nom}
                  </Text>
                  <Text style={styles.roleOptionDesc}>{opt.description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <Button
            title="Envoyer ma demande"
            variant="primary"
            size="md"
            loading={isSubmittingRole}
            onPress={handleSubmitRoleRequest}
            style={{ marginTop: 12 }}
          />
        </Card>

        {/* ── Danger zone ── */}
        <Card variant="elevated" style={styles.section}>
          <Button
            title="Se déconnecter"
            variant="outline"
            size="md"
            onPress={handleLogout}
            icon={<Ionicons name="log-out-outline" size={18} color={Palette.alert} />}
            style={styles.logoutButton}
          />
        </Card>
      </ScrollView>

      {/* Edit Profile Modal */}
      <EditProfileModal
        visible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── InfoRow helper ───────────────────────────────────────────────────────────

interface InfoRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconBg}>
        <Ionicons name={icon} size={16} color={Palette.primary} />
      </View>
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} weight="medium">
          {value && value.trim().length > 0 ? value : '—'}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  pageHeader: {
    marginBottom: 20,
  },
  pageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLogoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(217, 83, 79, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217, 83, 79, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  pageTitle: {
    color: Palette.text,
  },
  pageSubtitle: {
    marginTop: 4,
    color: Palette.textMuted,
  },
  heroCard: {
    marginBottom: 16,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  avatar: {
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarImage: {},
  avatarText: {
    color: '#FFFFFF',
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: Palette.primary,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  heroInfo: {
    flex: 1,
  },
  heroName: {
    color: Palette.text,
    marginBottom: 2,
  },
  heroEmail: {
    color: Palette.textMuted,
    fontSize: 13,
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(46, 125, 50, 0.08)',
    borderColor: 'rgba(46, 125, 50, 0.3)',
  },
  statusBadgePending: {
    backgroundColor: 'rgba(230, 138, 0, 0.08)',
    borderColor: 'rgba(230, 138, 0, 0.3)',
  },
  statusBadgeInactive: {
    backgroundColor: 'rgba(217, 83, 79, 0.08)',
    borderColor: 'rgba(217, 83, 79, 0.3)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotActive: {
    backgroundColor: Palette.success,
  },
  statusDotPending: {
    backgroundColor: '#D97706',
  },
  statusDotInactive: {
    backgroundColor: Palette.alert,
  },
  statusText: {
    fontSize: 12,
  },
  statusTextActive: {
    color: Palette.success,
  },
  statusTextPending: {
    color: '#D97706',
  },
  statusTextInactive: {
    color: Palette.alert,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.05)',
  },
  editButtonText: {
    color: Palette.primary,
    fontSize: 14,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 1,
    color: Palette.textMuted,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  infoIconBg: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 15,
    color: Palette.text,
  },
  currentRoleBadgeContainer: {
    backgroundColor: Palette.background,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    marginBottom: 16,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  roleIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleInfo: {
    flex: 1,
  },
  roleLabel: {
    fontSize: 15,
    color: Palette.text,
  },
  roleDescription: {
    fontSize: 12,
  },
  roleOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Palette.border,
    backgroundColor: Palette.card,
    marginBottom: 10,
  },
  roleOptionCardSelected: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.05)',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInnerCircle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Palette.primary,
  },
  roleOptionTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  roleOptionDesc: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  requestStatusBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Palette.background,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  requestStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoutButton: {
    borderColor: Palette.alert,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    backgroundColor: Palette.card,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  modalTitle: {
    color: Palette.text,
  },
  modalContent: {
    padding: 20,
    paddingBottom: 40,
  },
  modalSectionHeader: {
    fontSize: 12,
    letterSpacing: 1,
    color: Palette.primary,
    marginTop: 16,
    marginBottom: 12,
  },
  photoPickerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  securityDivider: {
    height: 1,
    backgroundColor: Palette.border,
    marginVertical: 20,
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
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(46, 125, 50, 0.1)',
    borderColor: 'rgba(46, 125, 50, 0.3)',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  autoPopulatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -8,
    marginBottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  autoPopulatedText: {
    fontSize: 12,
    color: Palette.primary,
  },
});

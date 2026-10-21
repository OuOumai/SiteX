import React, { useEffect, useState } from 'react';
import { isKmlPanoramaEligible, isKmlSource } from '@/lib/kmlPanorama';
import { KmlPanoramaViewer } from './KmlPanoramaViewer';
import { Image, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { getMediaUrl, KmlGroundOverlay, KmlPhotoOverlay } from '@/services/api';

export interface KmlImageModalProps {
  sourceFormat?: string;
  selectedKmlImage: KmlGroundOverlay | KmlPhotoOverlay | null;
  visible: boolean;
  isKmlImagesVisible: boolean;
  onClose: () => void;
  onToggleImages: () => void;
}

// Shared viewer used by infrastructure configuration and Carte SIG.
export function KmlImageModal({ selectedKmlImage, visible, isKmlImagesVisible, onClose, onToggleImages, sourceFormat }: KmlImageModalProps) {
  const [dimensions, setDimensions] = useState({ url: '', width: 0, height: 0 });
  const [panoramaOpen, setPanoramaOpen] = useState(false);
  const url = isKmlSource(sourceFormat) && selectedKmlImage?.icon?.href ? getMediaUrl(selectedKmlImage.icon.href) : '';
  useEffect(() => {
    setPanoramaOpen(false);
    setDimensions({ url: '', width: 0, height: 0 });
  }, [visible, url, sourceFormat]);
  const eligible = dimensions.url === url && isKmlPanoramaEligible(sourceFormat, selectedKmlImage, dimensions.width, dimensions.height);
  if (!isKmlSource(sourceFormat)) return null;
  return (
      <Modal
        visible={visible && !!selectedKmlImage}
        transparent
        animationType="fade"
        onRequestClose={() => panoramaOpen ? setPanoramaOpen(false) : onClose()}
      >
        {panoramaOpen && eligible && selectedKmlImage?.type === 'PhotoOverlay' ? (
          <KmlPanoramaViewer sourceFormat={sourceFormat} overlay={selectedKmlImage} width={dimensions.width} height={dimensions.height} onClose={() => setPanoramaOpen(false)} />
        ) : (
        <View style={styles.modalOverlay}>
          <View style={styles.kmlModalContainer}>
            {/* Header */}
            <View style={styles.kmlModalHeader}>
              <View style={[styles.kmlModalIconWrap, { backgroundColor: 'rgba(249, 115, 22, 0.15)' }]}>
                <Ionicons
                  name={selectedKmlImage?.type === 'PhotoOverlay' ? "camera" : "image"}
                  size={22}
                  color="#F97316"
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.kmlModalBadgeText}>
                    {selectedKmlImage?.type === 'PhotoOverlay' ? 'PHOTO KML (2D)' : 'IMAGE GÉORÉFÉRENCÉE KML'}
                  </Text>
                  <View style={styles.kmlSourceTag}>
                    <Text style={styles.kmlSourceTagText}>Niveau 4 — 2D</Text>
                  </View>
                </View>
                <Text variant="h2" style={styles.kmlModalTitle} weight="bold" numberOfLines={1}>
                  {selectedKmlImage?.name || (selectedKmlImage?.type === 'PhotoOverlay' ? 'Photo KML' : 'Image KML')}
                </Text>
                <Text style={styles.kmlModalSubtitle}>
                  {selectedKmlImage?.type === 'PhotoOverlay'
                    ? 'Photo contextuelle 2D avec positionnement et orientation'
                    : 'Superposition 2D d\'image sur emprise géographique (GroundOverlay)'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onClose()}
                style={styles.crsModalCloseBtn}
              >
                <Ionicons name="close" size={22} color={Palette.text} />
              </TouchableOpacity>
            </View>

            {/* Scrollable Content */}
            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {/* Image Preview / Availability Box */}
              <View style={styles.kmlSection}>
                <Text style={styles.kmlSectionTitle}>APERÇU DE L&apos;IMAGE</Text>
                {selectedKmlImage?.isSafe && selectedKmlImage.isAvailable && selectedKmlImage.icon?.href ? (
                  <View style={styles.kmlImagePreviewWrap}>
                    <Image
                      source={{ uri: getMediaUrl(selectedKmlImage.icon.href) }}
                      style={styles.kmlImagePreview}
                      resizeMode="contain"
                      onLoad={(event) => {
                        if (selectedKmlImage?.type !== 'PhotoOverlay') return;
                        const { width, height } = event.nativeEvent.source;
                        setDimensions({ url, width, height });
                      }}
                      onError={() => setDimensions({ url: '', width: 0, height: 0 })}
                    />
                    <Text style={styles.kmlImageHrefCaption} numberOfLines={1}>
                      Source : {getMediaUrl(selectedKmlImage.icon.href)}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.kmlImageUnavailableBox}>
                    <Ionicons name="image-outline" size={32} color={Palette.textMuted} />
                    <Text style={styles.kmlImageUnavailableTitle} weight="bold">
                      Ressource image non disponible
                    </Text>
                    <Text style={styles.kmlImageUnavailableDesc}>
                      {selectedKmlImage?.securityWarning ||
                        (selectedKmlImage?.icon?.href
                          ? `Le fichier image référencé ("${selectedKmlImage.icon.href}") n'a pas été fourni avec le KML.`
                          : 'Aucune référence d\'image <href> valide n\'est spécifiée.')}
                    </Text>
                    <Text style={styles.kmlImageUnavailableFootnote}>
                      L&apos;emprise et les métadonnées spatiales restent exploitables en 2D sur la carte.
                    </Text>
                  </View>
                )}
              </View>

              {/* Identification & Spatial Attributes */}
              <View style={styles.kmlSection}>
                <Text style={styles.kmlSectionTitle}>ATTRIBUTS SPATIAUX & GÉOMÉTRIE</Text>
                
                <View style={styles.kmlInfoRow}>
                  <Text style={styles.kmlInfoLabel}>Nom :</Text>
                  <Text style={styles.kmlInfoValue} weight="bold">
                    {selectedKmlImage?.name || '—'}
                  </Text>
                </View>

                <View style={styles.kmlInfoRow}>
                  <Text style={styles.kmlInfoLabel}>Type KML :</Text>
                  <Text style={styles.kmlInfoValue}>
                    {selectedKmlImage?.type === 'PhotoOverlay' ? 'PhotoOverlay' : 'GroundOverlay'}
                  </Text>
                </View>

                <View style={styles.kmlInfoRow}>
                  <Text style={styles.kmlInfoLabel}>Référence (href) :</Text>
                  <Text style={[styles.kmlInfoValue, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
                    {selectedKmlImage?.icon?.href || '—'}
                  </Text>
                </View>

                {selectedKmlImage?.type === 'GroundOverlay' && selectedKmlImage.latLonBox && (
                  <>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Emprise Nord :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlImage.latLonBox.north.toFixed(6)}°</Text>
                    </View>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Emprise Sud :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlImage.latLonBox.south.toFixed(6)}°</Text>
                    </View>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Emprise Est :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlImage.latLonBox.east.toFixed(6)}°</Text>
                    </View>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Emprise Ouest :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlImage.latLonBox.west.toFixed(6)}°</Text>
                    </View>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Opacité :</Text>
                      <Text style={styles.kmlInfoValue}>
                        {Math.round((selectedKmlImage.opacity || 1) * 100)}%
                        {selectedKmlImage.color ? ` (${selectedKmlImage.color})` : ''}
                      </Text>
                    </View>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Rotation :</Text>
                      <Text style={styles.kmlInfoValue}>
                        {selectedKmlImage.latLonBox.rotation !== undefined ? `${selectedKmlImage.latLonBox.rotation}°` : '0°'}
                        {Boolean(selectedKmlImage.latLonBox.rotation && selectedKmlImage.latLonBox.rotation !== 0) && (
                          <Text style={{ color: '#F59E0B', fontSize: 11 }}> (Visualisé sans rotation 2D)</Text>
                        )}
                      </Text>
                    </View>
                    {selectedKmlImage.drawOrder !== undefined && (
                      <View style={styles.kmlInfoRow}>
                        <Text style={styles.kmlInfoLabel}>Ordre d&apos;affichage (drawOrder) :</Text>
                        <Text style={styles.kmlInfoValue}>{selectedKmlImage.drawOrder}</Text>
                      </View>
                    )}
                  </>
                )}

                {selectedKmlImage?.type === 'PhotoOverlay' && (
                  <>
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Position 2D :</Text>
                      <Text style={styles.kmlInfoValue}>
                        {selectedKmlImage.position
                          ? `${selectedKmlImage.position[1].toFixed(6)}° N, ${selectedKmlImage.position[0].toFixed(6)}° E`
                          : '—'}
                      </Text>
                    </View>
                    {selectedKmlImage.altitude !== null && selectedKmlImage.altitude !== undefined && (
                      <View style={styles.kmlInfoRow}>
                        <Text style={styles.kmlInfoLabel}>Altitude :</Text>
                        <Text style={styles.kmlInfoValue}>{selectedKmlImage.altitude} m (métadonnée KML ; référence verticale non interprétée)</Text>
                      </View>
                    )}
                    {selectedKmlImage.heading !== null && selectedKmlImage.heading !== undefined && (
                      <View style={styles.kmlInfoRow}>
                        <Text style={styles.kmlInfoLabel}>Cap (Heading) :</Text>
                        <Text style={styles.kmlInfoValue}>{selectedKmlImage.heading}°</Text>
                      </View>
                    )}
                    {selectedKmlImage.tilt !== null && selectedKmlImage.tilt !== undefined && (
                      <View style={styles.kmlInfoRow}>
                        <Text style={styles.kmlInfoLabel}>Inclinaison (Tilt) :</Text>
                        <Text style={styles.kmlInfoValue}>{selectedKmlImage.tilt}°</Text>
                      </View>
                    )}
                    {selectedKmlImage.roll !== null && selectedKmlImage.roll !== undefined && (
                      <View style={styles.kmlInfoRow}>
                        <Text style={styles.kmlInfoLabel}>Roulis (Roll) :</Text>
                        <Text style={styles.kmlInfoValue}>{selectedKmlImage.roll}°</Text>
                      </View>
                    )}
                    {selectedKmlImage.shape && (
                      <View style={styles.kmlInfoRow}>
                        <Text style={styles.kmlInfoLabel}>Forme :</Text>
                        <Text style={styles.kmlInfoValue}>{selectedKmlImage.shape}</Text>
                      </View>
                    )}
                  </>
                )}

                {Boolean(selectedKmlImage?.folders && selectedKmlImage.folders.length > 0) && (
                  <View style={styles.kmlInfoRow}>
                    <Text style={styles.kmlInfoLabel}>Dossier :</Text>
                    <Text style={styles.kmlInfoValue}>{selectedKmlImage?.folders?.join(' ❯ ')}</Text>
                  </View>
                )}

                {Boolean(selectedKmlImage?.description) && (
                  <View style={styles.kmlInfoRowColumn}>
                    <Text style={styles.kmlInfoLabel}>Description :</Text>
                    <Text style={styles.kmlDescriptionBox}>{selectedKmlImage?.description}</Text>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Modal Actions */}
            {eligible && <Button title="Ouvrir en 360°" variant="primary" size="md" onPress={() => setPanoramaOpen(true)} />}
            <View style={styles.kmlModalFooter}>
              <TouchableOpacity
                style={[styles.kmlModalToggleBtn, !isKmlImagesVisible && styles.kmlModalToggleBtnOff]}
                onPress={() => onToggleImages()}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isKmlImagesVisible ? "eye-off-outline" : "eye-outline"}
                  size={16}
                  color={isKmlImagesVisible ? "#DC2626" : "#15803D"}
                />
                <Text style={[styles.kmlModalToggleText, !isKmlImagesVisible && { color: "#15803D" }]} weight="semibold">
                  {isKmlImagesVisible ? "Masquer calque Images" : "Afficher calque Images"}
                </Text>
              </TouchableOpacity>

              <Button
                title="Fermer"
                variant="primary"
                size="md"
                onPress={() => onClose()}
              />
            </View>
          </View>
        </View>
        )}
      </Modal>
  );
}

const styles = StyleSheet.create({
modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
crsModalCloseBtn: {
    padding: 4,
  },
kmlSourceTag: {
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
kmlSourceTagText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#9A3412',
  },
kmlModalContainer: {
    width: '92%',
    maxWidth: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 10,
  },
kmlModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
kmlModalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFEDD5',
  },
kmlModalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#EA580C',
    letterSpacing: 0.4,
  },
kmlModalTitle: {
    fontSize: 16,
    color: Palette.text,
    marginTop: 1,
  },
kmlModalSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
kmlSection: {
    marginBottom: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
kmlSectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: Palette.primary,
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
kmlInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
kmlInfoRowColumn: {
    paddingVertical: 4,
  },
kmlInfoLabel: {
    fontSize: 11.5,
    color: Palette.textMuted,
  },
kmlInfoValue: {
    fontSize: 12,
    color: Palette.text,
    maxWidth: '65%',
    textAlign: 'right',
  },
kmlDescriptionBox: {
    fontSize: 11.5,
    color: Palette.text,
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
    lineHeight: 16,
  },
kmlModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
kmlModalToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
  },
kmlModalToggleBtnOff: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
kmlModalToggleText: {
    fontSize: 12,
    color: '#DC2626',
  },
kmlImagePreviewWrap: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    marginTop: 4,
  },
kmlImagePreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#0F172A',
  },
kmlImageHrefCaption: {
    fontSize: 10,
    color: '#94A3B8',
    padding: 6,
    width: '100%',
    textAlign: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
  },
kmlImageUnavailableBox: {
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
kmlImageUnavailableTitle: {
    fontSize: 12.5,
    color: Palette.text,
  },
kmlImageUnavailableDesc: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
kmlImageUnavailableFootnote: {
    fontSize: 10,
    color: '#64748B',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 2,
  }
});

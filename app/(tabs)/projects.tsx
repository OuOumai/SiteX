import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal";
import { Palette } from "@/constants/theme";
import { api, Project, PaginationMeta } from "@/services/api";

function formatFrenchDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export type StatusFilter = "Tous" | "En cours" | "Terminés" | "En retard";

interface StatusTheme {
  color: string;
  bg: string;
  border: string;
  activePillBg: string;
  dotColor: string;
}

const STATUS_THEMES: Record<string, StatusTheme> = {
  "En cours": { color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE", activePillBg: "#2563EB", dotColor: "#2563EB" },
  "Terminés":  { color: "#7E22CE", bg: "#FAF5FF", border: "#E9D5FF", activePillBg: "#7E22CE", dotColor: "#9333EA" },
  "En retard": { color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA", activePillBg: "#EA580C", dotColor: "#EA580C" },
};
const DEFAULT_STATUS_THEME: StatusTheme = {
  color: "#475569", bg: "#F8FAFC", border: "#E2E8F0", activePillBg: "#475569", dotColor: "#64748B",
};

function getStatusTheme(statut?: string | null): StatusTheme {
  if (!statut) return STATUS_THEMES["En cours"];
  const n = statut.trim().toLowerCase();
  if (n.includes("retard")) return STATUS_THEMES["En retard"];
  if (n.includes("termin"))  return STATUS_THEMES["Terminés"];
  if (n.includes("cours"))   return STATUS_THEMES["En cours"];
  return STATUS_THEMES[statut.trim()] || DEFAULT_STATUS_THEME;
}

const PAGE_SIZE = 6;

export default function ProjectsScreen() {
  const router = useRouter();
  const { token, user, isLoading: isAuthLoading } = useAuth();
  const isResponsable =
    user?.role_nom === "Responsable" || user?.role_id === 2 ||
    user?.role_nom === "Administrateur" || user?.role_id === 1;

  // ── Data & Pagination State ──
  const [projects, setProjects]                 = useState<Project[]>([]);
  const [pagination, setPagination]             = useState<PaginationMeta | null>(null);
  const [currentPage, setCurrentPage]           = useState<number>(1);
  const [statusCounts, setStatusCounts]         = useState<Record<string, number>>({
    "Tous": 0, "En cours": 0, "Terminés": 0, "En retard": 0,
  });

  // ── Filters & Search ──
  const [searchQuery, setSearchQuery]           = useState("");
  const [debouncedSearch, setDebouncedSearch]   = useState("");
  const [selectedStatus, setSelectedStatus]     = useState<StatusFilter>("Tous");
  const [isLoading, setIsLoading]               = useState(true);
  const [isRefreshing, setIsRefreshing]         = useState(false);
  const [error, setError]                       = useState<string | null>(null);

  // ── Delete Mode State ──
  const [deleteMode, setDeleteMode]             = useState(false);
  const [deleteSearch, setDeleteSearch]         = useState("");
  const [selectedIds, setSelectedIds]           = useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting]             = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  // ── Debounce search query (350ms) ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Fetch paginated projects from backend ──
  const fetchProjects = useCallback(async (pageToFetch = 1, isRefresh = false) => {
    if (!token) {
      if (!isAuthLoading) setIsLoading(false);
      return;
    }

    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await api.getProjects(token, {
        page: pageToFetch,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        statut: selectedStatus,
      });

      setProjects(data.projects || []);
      if (data.pagination) {
        setPagination(data.pagination);
        setCurrentPage(data.pagination.page);
      }
      if (data.statusCounts) {
        setStatusCounts(data.statusCounts);
      }
    } catch (err: any) {
      setError(err.message || "Impossible de charger la liste des projets.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, isAuthLoading, debouncedSearch, selectedStatus]);

  // Trigger fetch when filter / page / search changes
  useEffect(() => {
    if (!isAuthLoading) {
      fetchProjects(currentPage);
    }
  }, [fetchProjects, currentPage, isAuthLoading]);

  // Reset page to 1 when status filter changes
  const handleStatusFilterChange = (newStatus: StatusFilter) => {
    if (newStatus !== selectedStatus) {
      setSelectedStatus(newStatus);
      setCurrentPage(1);
    }
  };

  // Page change handler
  const handleGoToPage = (newPage: number) => {
    if (newPage < 1 || (pagination && newPage > pagination.totalPages) || newPage === currentPage) return;
    setCurrentPage(newPage);
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  };

  // ── Delete-mode filtered list for local search ──
  const deleteFilteredProjects = useMemo(() => {
    const q = deleteSearch.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter(
      (p) => p.nom.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q))
    );
  }, [projects, deleteSearch]);

  const enterDeleteMode = () => {
    setDeleteMode(true);
    setDeleteSearch("");
    setSelectedIds(new Set());
  };

  const exitDeleteMode = () => {
    setDeleteMode(false);
    setDeleteSearch("");
    setSelectedIds(new Set());
    setShowConfirmModal(false);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === deleteFilteredProjects.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deleteFilteredProjects.map((p) => p.id)));
    }
  };

  const selectedProjectsList = useMemo(() => {
    return projects.filter((p) => selectedIds.has(p.id));
  }, [projects, selectedIds]);

  const handleOpenConfirmModal = () => {
    if (selectedIds.size === 0) return;
    setShowConfirmModal(true);
  };

  const handleExecuteDeletion = async () => {
    if (selectedIds.size === 0 || !token) return;
    const idsSnapshot = Array.from(selectedIds);
    const count = idsSnapshot.length;

    setIsDeleting(true);
    try {
      await api.bulkDeleteProjects(token, idsSnapshot);
      setShowConfirmModal(false);
      exitDeleteMode();
      // Refetch current page after deletion
      await fetchProjects(currentPage);
      Alert.alert("Succès", `${count} projet${count > 1 ? "s supprimés" : " supprimé"} avec succès.`);
    } catch (err: any) {
      Alert.alert("Erreur", err.message || "La suppression a échoué. Veuillez réessayer.");
    } finally {
      setIsDeleting(false);
    }
  };

  const statusFilterOptions: StatusFilter[] = ["Tous", "En cours", "Terminés", "En retard"];
  const allVisibleSelected = deleteFilteredProjects.length > 0 && deleteFilteredProjects.every((p) => selectedIds.has(p.id));

  // Compute pagination range for numbers
  const totalPages = pagination?.totalPages || 1;
  const totalItems = pagination?.total ?? projects.length;
  const startIndex = totalItems > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const endIndex   = totalItems > 0 ? Math.min(currentPage * PAGE_SIZE, totalItems) : 0;

  // Generate page numbers array
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }, [currentPage, totalPages]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Custom Styled Delete Confirmation Modal */}
      <DeleteConfirmationModal
        visible={showConfirmModal}
        title={
          selectedProjectsList.length > 1
            ? `Supprimer ${selectedProjectsList.length} projets ?`
            : `Supprimer « ${selectedProjectsList[0]?.nom || "ce projet"} » ?`
        }
        subtitle="Cette action est irréversible. Les chantiers, tronçons, observations et rapports associés seront définitivement supprimés."
        items={selectedProjectsList.map((p) => p.nom)}
        isDeleting={isDeleting}
        confirmText={
          selectedProjectsList.length > 1
            ? `Supprimer (${selectedProjectsList.length})`
            : "Supprimer définitivement"
        }
        cancelText="Annuler"
        onConfirm={handleExecuteDeletion}
        onCancel={() => setShowConfirmModal(false)}
      />

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchProjects(1, true)}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View style={styles.headerIconContainer}>
                <Ionicons name="folder-open" size={22} color={Palette.primary} />
              </View>
              <Text variant="h1" style={styles.headerTitle}>Projets</Text>
            </View>
            {isResponsable && !deleteMode && (
              <View style={styles.headerActions}>
                <TouchableOpacity style={styles.createProjectBtn} onPress={() => router.push("/responsable/projet/create")}>
                  <Ionicons name="add" size={16} color="#FFFFFF" />
                  <Text style={styles.createProjectBtnText} weight="bold">Nouveau</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteModeBtn} onPress={enterDeleteMode}>
                  <Ionicons name="trash-outline" size={15} color="#DC2626" />
                  <Text style={styles.deleteModeBtnText} weight="bold">Supprimer</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {!deleteMode && (
            <Text variant="subtitle" style={styles.headerSubtitle}>Suivi des programmes et chantiers de construction</Text>
          )}
        </View>

        {/* Delete mode banner */}
        {deleteMode && (
          <View style={styles.deleteBanner}>
            <View style={styles.deleteBannerSearch}>
              <View style={styles.deleteSearchBox}>
                <Ionicons name="search-outline" size={17} color={Palette.textMuted} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.deleteSearchInput}
                  placeholder="Rechercher un projet à supprimer..."
                  placeholderTextColor={Palette.textMuted}
                  value={deleteSearch}
                  onChangeText={setDeleteSearch}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {deleteSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setDeleteSearch("")}>
                    <Ionicons name="close-circle" size={17} color={Palette.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity style={styles.cancelDeleteBtn} onPress={exitDeleteMode}>
                <Text style={styles.cancelDeleteBtnText} weight="semibold">Annuler</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.selectionRow}>
              <TouchableOpacity style={styles.selectAllBtn} onPress={toggleSelectAll}>
                <View style={[styles.checkbox, allVisibleSelected && styles.checkboxChecked]}>
                  {allVisibleSelected && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                </View>
                <Text style={styles.selectAllText} weight="medium">
                  {allVisibleSelected ? "Tout désélectionner" : "Tout sélectionner"}
                </Text>
              </TouchableOpacity>
              {selectedIds.size > 0 ? (
                <View style={styles.selectionCountBadge}>
                  <Text style={styles.selectionCountText} weight="bold">
                    {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
                  </Text>
                </View>
              ) : (
                <Text style={styles.selectHint}>Sélectionnez des projets</Text>
              )}
            </View>

            {selectedIds.size > 0 && (
              <TouchableOpacity
                style={[styles.bulkDeleteBtn, isDeleting && styles.bulkDeleteBtnDisabled]}
                onPress={handleOpenConfirmModal}
                disabled={isDeleting}
              >
                {isDeleting
                  ? <ActivityIndicator size="small" color="#FFFFFF" />
                  : <Ionicons name="trash" size={17} color="#FFFFFF" />
                }
                <Text style={styles.bulkDeleteBtnText} weight="bold">
                  {isDeleting ? "Suppression en cours..." : `Supprimer la sélection (${selectedIds.size})`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Normal mode search + filters */}
        {!deleteMode && (
          <>
            <View style={styles.searchContainer}>
              <Ionicons name="search-outline" size={19} color={Palette.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher un projet..."
                placeholderTextColor={Palette.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={18} color={Palette.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.filtersContainer}>
              {statusFilterOptions.map((filter) => {
                const isSelected = selectedStatus === filter;
                const theme = filter !== "Tous" ? STATUS_THEMES[filter] : null;
                const activeBg = filter === "Tous" ? Palette.primary : theme?.activePillBg || Palette.primary;
                const count = statusCounts[filter];
                const displayText = filter === "Tous" ? `Tous (${count})` : isSelected ? `${filter} (${count})` : filter;
                return (
                  <TouchableOpacity
                    key={filter}
                    style={[
                      styles.filterPill,
                      isSelected && { backgroundColor: activeBg, borderColor: activeBg },
                      !isSelected && theme && { borderColor: "rgba(0,0,0,0.08)" },
                    ]}
                    activeOpacity={0.75}
                    onPress={() => setSelectedStatus(filter)}
                  >
                    {!isSelected && theme && <View style={[styles.filterDot, { backgroundColor: theme.dotColor }]} />}
                    <Text
                      style={[styles.filterText, isSelected ? styles.filterTextActive : styles.filterTextInactive]}
                      weight={isSelected ? "bold" : "medium"}
                      numberOfLines={1}
                    >
                      {displayText}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Content */}
        {isLoading ? (
          <Card variant="elevated" style={styles.stateCard}>
            <ActivityIndicator size="small" color={Palette.primary} />
            <Text variant="muted" style={styles.stateText}>Chargement des projets...</Text>
          </Card>
        ) : error ? (
          <Card variant="elevated" style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={28} color={Palette.alert} />
            <Text variant="error" style={styles.stateErrorText}>{error}</Text>
            <TouchableOpacity onPress={() => fetchProjects(currentPage)} style={styles.retryButton}>
              <Text style={styles.retryButtonText} weight="semibold">Réessayer</Text>
            </TouchableOpacity>
          </Card>
        ) : deleteMode ? (
          deleteFilteredProjects.length === 0 ? (
            <Card variant="elevated" style={styles.stateCard}>
              <Ionicons name="search-outline" size={32} color={Palette.textMuted} />
              <Text variant="subtitle" style={styles.emptyTitle}>Aucun résultat</Text>
              <Text variant="muted" style={styles.emptySubtitle}>Aucun projet ne correspond à « {deleteSearch} » sur cette page.</Text>
            </Card>
          ) : (
            <View style={styles.projectsList}>
              {deleteFilteredProjects.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const statusTheme = getStatusTheme(item.statut);
                return (
                  <TouchableOpacity key={item.id} activeOpacity={0.85} onPress={() => toggleSelect(item.id)}>
                    <Card
                      variant="elevated"
                      style={[
                        styles.projectCard,
                        { borderLeftColor: isSelected ? "#DC2626" : statusTheme.dotColor },
                        isSelected && styles.projectCardSelected,
                      ]}
                    >
                      <View style={styles.cardHeader}>
                        <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                          {isSelected && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text variant="h2" style={[styles.projectTitle, isSelected && styles.projectTitleSelected]}>
                            {item.nom}
                          </Text>
                          {Boolean(item.description) && (
                            <Text variant="muted" style={styles.projectDescription} numberOfLines={1}>
                              {item.description}
                            </Text>
                          )}
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: statusTheme.bg, borderColor: statusTheme.border }]}>
                          <View style={[styles.statusBadgeDot, { backgroundColor: statusTheme.dotColor }]} />
                          <Text style={[styles.statusBadgeText, { color: statusTheme.color }]} weight="bold">
                            {item.statut || "En cours"}
                          </Text>
                        </View>
                      </View>
                      {(item.date_debut || item.date_fin) && (
                        <View style={styles.dateRow}>
                          <View style={styles.calendarIconWrapper}>
                            <Ionicons name="calendar-outline" size={13} color={Palette.primary} />
                          </View>
                          <Text style={styles.dateText} weight="medium">
                            {formatFrenchDate(item.date_debut)} → {formatFrenchDate(item.date_fin)}
                          </Text>
                        </View>
                      )}
                      {isSelected && (
                        <View style={styles.selectedIndicator}>
                          <Ionicons name="checkmark-circle" size={14} color="#DC2626" />
                          <Text style={styles.selectedIndicatorText} weight="semibold">Sélectionné pour suppression</Text>
                        </View>
                      )}
                    </Card>
                  </TouchableOpacity>
                );
              })}
            </View>
          )
        ) : projects.length === 0 ? (
          <Card variant="elevated" style={styles.emptyCard}>
            <Ionicons name="folder-open-outline" size={40} color={Palette.textMuted} />
            <Text variant="subtitle" style={styles.emptyTitle}>
              {searchQuery.trim() ? "Aucun projet trouvé" : "Aucun projet disponible"}
            </Text>
            <Text variant="muted" style={styles.emptySubtitle}>
              {searchQuery.trim()
                ? `Aucun projet ne correspond à « ${searchQuery} » avec le filtre « ${selectedStatus} ».`
                : selectedStatus !== "Tous"
                ? `Aucun projet n'a actuellement le statut « ${selectedStatus} ».`
                : "Les projets assignés à votre espace apparaîtront ici dès leur création."}
            </Text>
          </Card>
        ) : (
          <View style={styles.projectsList}>
            {projects.map((item) => {
              const displayStatus = item.statut || "En cours";
              const statusTheme = getStatusTheme(displayStatus);
              return (
                <Card key={item.id} variant="elevated" style={[styles.projectCard, { borderLeftColor: statusTheme.dotColor }]}>
                  <View style={styles.cardHeader}>
                    <Text variant="h2" style={styles.projectTitle}>{item.nom}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusTheme.bg, borderColor: statusTheme.border }]}>
                      <View style={[styles.statusBadgeDot, { backgroundColor: statusTheme.dotColor }]} />
                      <Text style={[styles.statusBadgeText, { color: statusTheme.color }]} weight="bold">{displayStatus}</Text>
                    </View>
                  </View>
                  {Boolean(item.description) && (
                    <Text variant="muted" style={styles.projectDescription}>{item.description}</Text>
                  )}
                  {(item.date_debut || item.date_fin) && (
                    <View style={styles.dateRow}>
                      <View style={styles.calendarIconWrapper}>
                        <Ionicons name="calendar-outline" size={13} color={Palette.primary} />
                      </View>
                      <Text style={styles.dateText} weight="medium">
                        {formatFrenchDate(item.date_debut)} → {formatFrenchDate(item.date_fin)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.cardFooter}>
                    <TouchableOpacity
                      style={styles.viewProjectButton}
                      activeOpacity={0.7}
                      onPress={() => router.push((isResponsable ? `/responsable/projet/${item.id}` : `/project/${item.id}`) as any)}
                    >
                      <Text style={styles.viewProjectText} weight="bold">Voir le projet →</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* ── PAGINATION CONTROLS ── */}
        {!isLoading && totalPages > 1 && (
          <View style={styles.paginationContainer}>
            <View style={styles.paginationControlsRow}>
              {/* Previous Page Button */}
              <TouchableOpacity
                style={[styles.pageNavBtn, currentPage === 1 && styles.pageNavBtnDisabled]}
                onPress={() => handleGoToPage(currentPage - 1)}
                disabled={currentPage === 1}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={18} color={currentPage === 1 ? Palette.textLight : Palette.primary} />
                <Text style={[styles.pageNavBtnText, currentPage === 1 && styles.pageNavBtnTextDisabled]} weight="semibold">
                  Précédent
                </Text>
              </TouchableOpacity>

              {/* Numeric Page Buttons */}
              <View style={styles.pageNumbersGroup}>
                {pageNumbers.map((num) => {
                  const isCurrent = num === currentPage;
                  return (
                    <TouchableOpacity
                      key={num}
                      style={[styles.pageNumPill, isCurrent && styles.pageNumPillActive]}
                      onPress={() => handleGoToPage(num)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[styles.pageNumText, isCurrent && styles.pageNumTextActive]}
                        weight={isCurrent ? "bold" : "medium"}
                      >
                        {num}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Next Page Button */}
              <TouchableOpacity
                style={[styles.pageNavBtn, currentPage >= totalPages && styles.pageNavBtnDisabled]}
                onPress={() => handleGoToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                activeOpacity={0.7}
              >
                <Text style={[styles.pageNavBtnText, currentPage >= totalPages && styles.pageNavBtnTextDisabled]} weight="semibold">
                  Suivant
                </Text>
                <Ionicons name="chevron-forward" size={18} color={currentPage >= totalPages ? Palette.textLight : Palette.primary} />
              </TouchableOpacity>
            </View>

            {/* Pagination summary info */}
            <Text style={styles.paginationSummaryText}>
              Affichage {startIndex} - {endIndex} sur {totalItems} projet{totalItems > 1 ? "s" : ""} • Page {currentPage} sur {totalPages}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.background },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  header: { marginBottom: 16 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerIconContainer: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(23, 107, 91, 0.1)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 24, color: Palette.text, letterSpacing: -0.3 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  createProjectBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Palette.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  createProjectBtnText: { color: "#FFFFFF", fontSize: 13 },
  deleteModeBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  deleteModeBtnText: { color: "#DC2626", fontSize: 13 },
  headerSubtitle: { marginTop: 4, fontSize: 13, color: Palette.textMuted },
  deleteBanner: { backgroundColor: "#FFF5F5", borderWidth: 1, borderColor: "#FED7D7", borderRadius: 14, padding: 14, marginBottom: 16, gap: 12 },
  deleteBannerSearch: { flexDirection: "row", alignItems: "center", gap: 10 },
  deleteSearchBox: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#FCA5A5", borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 },
  deleteSearchInput: { flex: 1, fontSize: 14, color: Palette.text, padding: 0 },
  cancelDeleteBtn: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: Palette.border, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  cancelDeleteBtnText: { color: Palette.text, fontSize: 13 },
  selectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectAllBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectAllText: { fontSize: 13, color: Palette.text },
  selectHint: { fontSize: 12, color: Palette.textMuted, fontStyle: "italic" },
  selectionCountBadge: { backgroundColor: "#DC2626", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  selectionCountText: { color: "#FFFFFF", fontSize: 12 },
  bulkDeleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#DC2626", paddingVertical: 13, borderRadius: 12, shadowColor: "#DC2626", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  bulkDeleteBtnDisabled: { backgroundColor: "#EF4444", opacity: 0.75 },
  bulkDeleteBtnText: { color: "#FFFFFF", fontSize: 15 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkboxChecked: { backgroundColor: "#DC2626", borderColor: "#DC2626" },
  searchContainer: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: Palette.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Palette.text, padding: 0 },
  filtersContainer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 16 },
  filterPill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 4, paddingVertical: 7, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: Palette.border },
  filterDot: { width: 5.5, height: 5.5, borderRadius: 2.75 },
  filterText: { fontSize: 11.5, textAlign: "center" },
  filterTextActive: { color: "#FFFFFF" },
  filterTextInactive: { color: Palette.text },
  projectsList: { gap: 14 },
  projectCard: { padding: 18, borderLeftWidth: 4, backgroundColor: "#FFFFFF" },
  projectCardSelected: { backgroundColor: "#FFF5F5", borderLeftColor: "#DC2626", shadowColor: "#DC2626", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  projectTitle: { fontSize: 17, color: Palette.text, lineHeight: 23, flex: 1 },
  projectTitleSelected: { color: "#991B1B" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14, borderWidth: 1, alignSelf: "flex-start" },
  statusBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 11, letterSpacing: 0.2 },
  projectDescription: { fontSize: 13, color: Palette.textMuted, lineHeight: 19, marginBottom: 12 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 14 },
  calendarIconWrapper: { width: 22, height: 22, borderRadius: 6, backgroundColor: "rgba(23, 107, 91, 0.08)", alignItems: "center", justifyContent: "center" },
  dateText: { fontSize: 12, color: Palette.textMuted },
  cardFooter: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  viewProjectButton: { paddingVertical: 4, paddingHorizontal: 2 },
  viewProjectText: { fontSize: 14, color: Palette.primary },
  selectedIndicator: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#FECACA" },
  selectedIndicatorText: { fontSize: 12, color: "#DC2626" },
  stateCard: { padding: 28, alignItems: "center", justifyContent: "center", gap: 10 },
  stateText: { fontSize: 13 },
  stateErrorText: { fontSize: 13, textAlign: "center" },
  retryButton: { marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: Palette.primary, borderRadius: 8 },
  retryButtonText: { color: "#FFFFFF", fontSize: 13 },
  emptyCard: { padding: 28, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 15, marginTop: 4, textAlign: "center" },
  emptySubtitle: { fontSize: 12, textAlign: "center", color: Palette.textMuted, lineHeight: 18 },

  // ── Pagination Styles ──
  paginationContainer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
    alignItems: "center",
    gap: 12,
  },
  paginationControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 6,
  },
  pageNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Palette.border,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  pageNavBtnDisabled: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    opacity: 0.6,
  },
  pageNavBtnText: {
    fontSize: 12.5,
    color: Palette.primary,
  },
  pageNavBtnTextDisabled: {
    color: Palette.textLight,
  },
  pageNumbersGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  pageNumPill: {
    minWidth: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  pageNumPillActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  pageNumText: {
    fontSize: 13,
    color: Palette.text,
  },
  pageNumTextActive: {
    color: "#FFFFFF",
  },
  paginationSummaryText: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: "center",
  },
});


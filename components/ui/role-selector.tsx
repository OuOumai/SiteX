import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './text';
import { Palette, Roles } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

interface RoleSelectorProps {
  selectedRoleId: number;
  onSelectRole: (roleId: number) => void;
  error?: string;
}

const roleIcons: Record<number, keyof typeof Ionicons.glyphMap> = {
  1: 'shield-checkmark-outline', // Admin
  2: 'briefcase-outline', // Project Manager
  3: 'construct-outline', // Field Agent
  4: 'eye-outline', // Client
};

export function RoleSelector({ selectedRoleId, onSelectRole, error }: RoleSelectorProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.titleLabel} weight="medium">
        Select Role / Rôle
      </Text>
      <View style={styles.grid}>
        {Roles.map((role) => {
          const isSelected = selectedRoleId === role.id;
          const iconName = roleIcons[role.id] || 'person-outline';

          return (
            <TouchableOpacity
              key={role.id}
              activeOpacity={0.8}
              onPress={() => onSelectRole(role.id)}
              style={[
                styles.roleCard,
                isSelected && styles.roleCardSelected,
              ]}
            >
              <View
                style={[
                  styles.iconCircle,
                  isSelected && styles.iconCircleSelected,
                ]}
              >
                <Ionicons
                  name={iconName}
                  size={20}
                  color={isSelected ? '#FFFFFF' : Palette.primary}
                />
              </View>
              <Text
                style={[
                  styles.roleText,
                  isSelected && styles.roleTextSelected,
                ]}
                weight={isSelected ? 'semibold' : 'medium'}
              >
                {role.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? <Text variant="error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
  },
  titleLabel: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Palette.card,
    borderWidth: 1.5,
    borderColor: Palette.inputBorder,
  },
  roleCardSelected: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  iconCircleSelected: {
    backgroundColor: Palette.primary,
  },
  roleText: {
    fontSize: 13,
    color: Palette.text,
    flex: 1,
  },
  roleTextSelected: {
    color: Palette.primary,
  },
});

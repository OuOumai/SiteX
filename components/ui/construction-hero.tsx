import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Path, Circle, G, Line } from 'react-native-svg';
import { Palette } from '@/constants/theme';

export function ConstructionHero() {
  return (
    <View style={styles.container}>
      <Svg width={180} height={130} viewBox="0 0 200 150" fill="none">
        {/* Background Grid Lines (Satellite Map Overlay) */}
        <G opacity={0.25}>
          <Line x1="10" y1="30" x2="190" y2="30" stroke={Palette.primary} strokeWidth="1" strokeDasharray="3,3" />
          <Line x1="10" y1="70" x2="190" y2="70" stroke={Palette.primary} strokeWidth="1" strokeDasharray="3,3" />
          <Line x1="10" y1="110" x2="190" y2="110" stroke={Palette.primary} strokeWidth="1" strokeDasharray="3,3" />
          <Line x1="50" y1="10" x2="50" y2="140" stroke={Palette.primary} strokeWidth="1" strokeDasharray="3,3" />
          <Line x1="100" y1="10" x2="100" y2="140" stroke={Palette.primary} strokeWidth="1" strokeDasharray="3,3" />
          <Line x1="150" y1="10" x2="150" y2="140" stroke={Palette.primary} strokeWidth="1" strokeDasharray="3,3" />
        </G>

        {/* Construction Crane */}
        <Path
          d="M30 130 L30 30 L110 30"
          stroke={Palette.accent}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M30 50 L50 30" stroke={Palette.accent} strokeWidth="2.5" />
        <Path d="M30 70 L70 30" stroke={Palette.accent} strokeWidth="2.5" />
        <Path d="M30 90 L90 30" stroke={Palette.accent} strokeWidth="2.5" />
        {/* Crane Cable & Hook */}
        <Line x1="100" y1="30" x2="100" y2="65" stroke={Palette.textMuted} strokeWidth="1.5" strokeDasharray="2,2" />
        <Path d="M96 65 L104 65 L100 72 Z" fill={Palette.accent} />

        {/* Main Site Structure / Building */}
        <Rect x="75" y="70" width="60" height="60" rx="4" fill={Palette.primary} />
        {/* Building Roof */}
        <Path d="M68 70 L105 42 L142 70 Z" fill={Palette.secondary} />
        
        {/* Windows */}
        <Rect x="85" y="80" width="12" height="14" rx="2" fill="#FFFFFF" opacity={0.9} />
        <Rect x="113" y="80" width="12" height="14" rx="2" fill="#FFFFFF" opacity={0.9} />
        <Rect x="85" y="102" width="12" height="14" rx="2" fill="#FFFFFF" opacity={0.9} />
        
        {/* Entrance Door */}
        <Rect x="112" y="102" width="14" height="28" rx="2" fill={Palette.accent} />

        {/* Satellite Imagery Scanning Beam */}
        <Circle cx="165" cy="28" r="14" fill={Palette.secondary} opacity={0.2} />
        <Circle cx="165" cy="28" r="7" fill={Palette.secondary} />
        <Path d="M165 35 L140 100 L180 100 Z" fill={Palette.secondary} opacity={0.12} />
        <Circle cx="165" cy="28" r="3" fill="#FFFFFF" />

        {/* Satellite Dish Icon */}
        <Path d="M158 22 C162 16, 172 18, 172 26" stroke={Palette.accent} strokeWidth="2" strokeLinecap="round" />

        {/* Ground Line */}
        <Line x1="15" y1="130" x2="185" y2="130" stroke={Palette.primaryDark} strokeWidth="3" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
});

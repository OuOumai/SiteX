import React, { useState } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  View,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Text } from './text';
import { Palette } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';

export interface InputProps extends RNTextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isPassword?: boolean;
}

export function Input({
  label,
  error,
  leftIcon,
  rightIcon,
  isPassword = false,
  style,
  onFocus,
  onBlur,
  secureTextEntry,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [hidePassword, setHidePassword] = useState(isPassword);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={styles.label} weight="medium">
          {label}
        </Text>
      )}
      <View
        style={[
          styles.inputWrapper,
          props.multiline && styles.multilineWrapper,
          isFocused && styles.focusedWrapper,
          !!error && styles.errorWrapper,
        ]}
      >
        {leftIcon && (
          <View style={[styles.leftIconWrapper, props.multiline && styles.multilineLeftIcon]}>
            {leftIcon}
          </View>
        )}
        <RNTextInput
          style={[
            styles.input,
            props.multiline && styles.multilineInput,
            style,
          ]}
          placeholderTextColor={Palette.textLight}
          secureTextEntry={isPassword ? hidePassword : secureTextEntry}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {rightIcon && !isPassword && <View style={styles.rightIconWrapper}>{rightIcon}</View>}
        {isPassword && (
          <TouchableOpacity
            onPress={() => setHidePassword(!hidePassword)}
            style={styles.rightIconWrapper}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={hidePassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={Palette.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text variant="error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    fontSize: 14,
    color: Palette.text,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.inputBg,
    borderWidth: 1.5,
    borderColor: Palette.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  multilineWrapper: {
    height: undefined,
    minHeight: 85,
    alignItems: 'flex-start',
    paddingTop: 12,
    paddingBottom: 12,
  },
  multilineLeftIcon: {
    marginTop: 2,
  },
  focusedWrapper: {
    borderColor: Palette.primary,
    backgroundColor: '#FFFFFF',
  },
  errorWrapper: {
    borderColor: Palette.alert,
  },
  leftIconWrapper: {
    marginRight: 10,
  },
  rightIconWrapper: {
    marginLeft: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Palette.text,
    paddingVertical: 8,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
    paddingTop: 0,
    paddingBottom: 0,
  },
});

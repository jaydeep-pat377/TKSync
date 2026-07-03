import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import Icon from './Icon';
import ResponsiveModal from './ResponsiveModal';
import {useTheme} from '../contexts/ThemeContext';
import {wp, ms} from '../utils/responsive';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';

type Props = {
  visible: boolean;
  type: 'success' | 'error';
  title: string;
  message: string;
  onClose: () => void;
  buttonText?: string;
};

export default function ThemedAlert({visible, type, title, message, onClose, buttonText = 'OK'}: Props) {
  useFontScaleRefresh();
  const s = createS();
  const {c} = useTheme();

  const isSuccess = type === 'success';
  const iconName = isSuccess ? 'check-circle' : 'error';
  const iconColor = isSuccess ? c.successDark : c.error;
  const iconBg = isSuccess ? c.successSurface : c.errorSurface;
  const btnBg = isSuccess ? c.successDark : c.error;

  return (
    <ResponsiveModal visible={visible} onClose={onClose} maxWidth={360} widthPercent={80}>
      <View style={s.content}>
        <View style={[s.iconWrap, {backgroundColor: iconBg}]}>
          <Icon name={iconName} size={ms(28)} color={iconColor} />
        </View>
        <Text style={[s.title, {color: c.textPrimary}]}>{title}</Text>
        <Text style={[s.message, {color: c.textSecondary}]}>{message}</Text>
        <TouchableOpacity
          style={[s.btn, {backgroundColor: btnBg}]}
          onPress={onClose}
          activeOpacity={0.7}>
          <Text style={[s.btnText, {color: c.textOnPrimary}]}>{buttonText}</Text>
        </TouchableOpacity>
      </View>
    </ResponsiveModal>
  );
}

const createS = () => StyleSheet.create({
  content: {padding: wp(16), alignItems: 'center'},
  iconWrap: {width: wp(48), height: wp(48), borderRadius: wp(24), justifyContent: 'center', alignItems: 'center', marginBottom: wp(10)},
  title: {fontSize: ms(17), fontWeight: '700', marginBottom: wp(4)},
  message: {fontSize: ms(12), fontWeight: '400', textAlign: 'center', lineHeight: ms(17), marginBottom: wp(14)},
  btn: {width: '100%', paddingVertical: wp(10), borderRadius: wp(10), alignItems: 'center', justifyContent: 'center'},
  btnText: {fontSize: ms(14), fontWeight: '600'},
});

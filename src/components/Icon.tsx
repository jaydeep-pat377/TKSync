import React from 'react';
import {StyleProp, ViewStyle} from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import BellIcon from '../assets/svgs/bell.svg';
import EyeIcon from '../assets/svgs/eye.svg';
import MoonIcon from '../assets/svgs/moon.svg';
import QrCodeIcon from '../assets/svgs/qr-code.svg';
import RefreshIcon from '../assets/svgs/refresh.svg';
import SettingsIcon from '../assets/svgs/settings-gear.svg';
import SunIcon from '../assets/svgs/sun.svg';
import TruckIcon from '../assets/svgs/truck.svg';
import TicketTagIcon from '../assets/svgs/ticket-tag.svg';
import WifiIcon from '../assets/svgs/wifi.svg';

const SVG_MAP: Record<string, React.FC<any>> = {
  'notifications': BellIcon,
  'visibility': EyeIcon,
  'dark-mode': MoonIcon,
  'light-mode': SunIcon,
  'qr-code-2': QrCodeIcon,
  'refresh': RefreshIcon,
  'settings': SettingsIcon,
  'local-shipping': TruckIcon,
  'label': TicketTagIcon,
  'wifi': WifiIcon,
};

type IconProps = {
  name: string;
  size: number;
  color: string;
  style?: StyleProp<ViewStyle>;
};

const Icon: React.FC<IconProps> = ({name, size, color, style}) => {
  const SvgIcon = SVG_MAP[name];
  if (SvgIcon) {
    return <SvgIcon width={size} height={size} color={color} style={style} />;
  }
  return <MaterialIcons name={name as any} size={size} color={color} style={style} />;
};

export default Icon;

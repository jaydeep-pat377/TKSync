import * as React from 'react';
import Svg, {Path, Circle, Rect, G} from 'react-native-svg';

interface TruckProps {
  width?: number;
  height?: number;
  bodyColor: string;
  bodyLightColor: string;
  windshieldColor: string;
}

const YellowTruck: React.FC<TruckProps> = ({
  width = 157,
  height = 86,
  bodyColor,
  bodyLightColor,
  windshieldColor,
}) => {
  return (
    <Svg width={width} height={height} viewBox="0 0 157 86" fill="none">
      <G>
        <Rect x="10" y="25" width="85" height="40" rx="4" fill={bodyColor} />
        <Rect x="12" y="27" width="81" height="36" rx="3" fill={bodyLightColor} />
        <Rect x="18" y="32" width="20" height="26" rx="2" fill={bodyColor} />
        <Rect x="42" y="32" width="20" height="26" rx="2" fill={bodyColor} />
        <Rect x="66" y="32" width="20" height="26" rx="2" fill={bodyColor} />
        <Path d="M95 30 L95 65 L140 65 L140 45 L125 30 Z" fill={bodyColor} />
        <Path d="M97 32 L97 63 L138 63 L138 46 L124 32 Z" fill={bodyLightColor} />
        <Path d="M100 35 L100 50 L125 50 L125 40 L115 35 Z" fill={windshieldColor} opacity={0.8} />
        <Path d="M102 37 L102 42 L110 42 L110 37 Z" fill="#FFFFFF" opacity={0.4} />
        <Rect x="136" y="50" width="6" height="8" rx="1" fill="#D9D9D9" />
        <Rect x="135" y="60" width="10" height="5" rx="1" fill="#585957" />
        <Rect x="25" y="65" width="110" height="6" rx="2" fill="#585957" />
      </G>
      <G>
        <Circle cx="47" cy="71" r="14" fill="#323232" />
        <Circle cx="47" cy="71" r="10" fill="#585957" />
        <Circle cx="47" cy="71" r="5" fill="#323232" />
        <Circle cx="127" cy="71" r="12" fill="#323232" />
        <Circle cx="127" cy="71" r="8" fill="#585957" />
        <Circle cx="127" cy="71" r="4" fill="#323232" />
      </G>
      <Rect x="90" y="18" width="4" height="12" rx="2" fill="#585957" />
    </Svg>
  );
};

export default YellowTruck;

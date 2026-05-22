import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {Colors} from '../constants/colors';

const TICKETS = ['26209538', '31369591', '31369583'];

const TIMELINE = [
  {label: 'TICKETED', time: '07:46', icon: 'receipt-long', done: true},
  {label: 'LOADING', time: '07:49', icon: 'hourglass-bottom', done: true},
  {label: 'TO JOB', time: '08:05', icon: 'local-shipping', done: true},
  {label: 'ON JOB', time: '08:23', icon: 'location-on', done: true},
  {label: 'POURING', time: '08:46', icon: 'water-drop', done: true},
  {label: 'WASHING', time: '09:08', icon: 'clean-hands', done: true},
  {label: 'TO PLANT', time: '09:10', icon: 'route', done: true},
  {label: 'AT PLANT', time: '--', icon: 'factory', done: false},
];

const JOB_INFO = [
  {label: 'CUSTOMER', value: 'GILLAM CONSTRUCTION GROUP', icon: 'people'},
  {
    label: 'PROJECT',
    value: 'BLDG A - SEWELLS ROAD RESIDENTIAL BUILDI',
    icon: 'apartment',
  },
  {
    label: 'JOB',
    value: 'BLDG A - SEWELLS ROAD RESIDENTIAL BUILDI',
    icon: 'work',
  },
];

const MIX_INFO = [
  {label: 'MIXID', value: '6138438'},
  {label: 'DESCRIPTION', value: '30MPA MR', isLink: true},
  {label: 'USAGE', value: 'SUSPENDED SLAB'},
  {label: 'SLUMP', value: '120+-30 mm', isHighlight: true},
];

const BOTTOM_ACTIONS = [
  {icon: 'menu', label: 'Menu'},
  {icon: 'edit', label: 'Edit'},
  {icon: 'label', label: 'Tag'},
  {icon: 'block', label: 'Reject'},
  {icon: 'qr-code-scanner', label: 'QR'},
  {icon: 'refresh', label: 'Refresh'},
];

export default function DashboardScreen() {
  const [activeTicket, setActiveTicket] = useState(0);
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const isTablet = width > 600;

  return (
    <View style={styles.container}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      {/* Top Header Bar */}
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <View style={styles.headerLeft}>
          <View style={styles.headerLogo}>
            <MaterialIcons
              name="local-shipping"
              size={20}
              color={Colors.textOnPrimary}
            />
          </View>
          <View>
            <Text style={styles.headerTitle}>TKSync</Text>
            <Text style={styles.headerSub}>Ticket Tracking</Text>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ticketTabs}>
          {TICKETS.map((ticket, index) => (
            <TouchableOpacity
              key={ticket}
              activeOpacity={0.7}
              style={[
                styles.ticketTab,
                activeTicket === index && styles.ticketTabActive,
              ]}
              onPress={() => setActiveTicket(index)}>
              <Text
                style={[
                  styles.ticketTabText,
                  activeTicket === index && styles.ticketTabTextActive,
                ]}>
                {ticket}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.headerMenuBtn} activeOpacity={0.6}>
          <MaterialIcons
            name="more-vert"
            size={24}
            color={Colors.textOnPrimary}
          />
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Ticket Info Card */}
        <View style={styles.ticketCard}>
          <View style={styles.ticketCardTop}>
            <View style={styles.ticketMainInfo}>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>TICKET</Text>
                <Text style={styles.ticketNumber}>26209538</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>ORDER</Text>
                <Text style={styles.ticketOrderNum}>2605</Text>
              </View>
            </View>
            <View style={styles.ticketMeta}>
              <View style={styles.truckBadge}>
                <MaterialIcons
                  name="local-shipping"
                  size={16}
                  color={Colors.primary}
                />
                <Text style={styles.truckBadgeText}>108693</Text>
                <View style={styles.truckSubBadge}>
                  <Text style={styles.truckSubText}>772</Text>
                </View>
              </View>
              <View style={styles.weatherBox}>
                <MaterialIcons name="wb-sunny" size={18} color={Colors.warning} />
                <Text style={styles.weatherPlant}>26-SCARBOROUGH R/M</Text>
                <Text style={styles.weatherTemp}>10C Clear Sky</Text>
              </View>
            </View>
          </View>
          <View style={styles.ticketCardBadges}>
            <View style={styles.badgeActive}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeActiveText}>ACTIVE</Text>
            </View>
            <View style={styles.badgeAccount}>
              <MaterialIcons
                name="warning"
                size={14}
                color={Colors.warningBorder}
              />
              <Text style={styles.badgeAccountText}>ON ACCOUNT</Text>
            </View>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.timelineCard}>
          <View style={styles.timelineHeader}>
            <MaterialIcons name="timeline" size={18} color={Colors.primary} />
            <Text style={styles.timelineTitle}>Delivery Progress</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.timelineScroll}>
            {TIMELINE.map((item, index) => (
              <View key={item.label} style={styles.timelineStep}>
                {index > 0 && (
                  <View
                    style={[
                      styles.timelineConnector,
                      !item.done && styles.timelineConnectorPending,
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.timelineCircle,
                    item.done
                      ? styles.timelineCircleDone
                      : styles.timelineCirclePending,
                  ]}>
                  <MaterialIcons
                    name={item.done ? 'check' : (item.icon as any)}
                    size={14}
                    color={
                      item.done ? Colors.textOnPrimary : Colors.textMuted
                    }
                  />
                </View>
                <Text
                  style={[
                    styles.timelineStepLabel,
                    !item.done && styles.timelineStepLabelPending,
                  ]}>
                  {item.label}
                </Text>
                <Text
                  style={[
                    styles.timelineStepTime,
                    !item.done && styles.timelineStepTimePending,
                  ]}>
                  {item.time}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Details Section */}
        <View
          style={[
            styles.detailsContainer,
            isTablet && styles.detailsContainerTablet,
          ]}>
          {/* Job Info */}
          <View style={[styles.detailCard, isTablet && styles.detailCardHalf]}>
            <View style={styles.detailCardHeader}>
              <MaterialIcons name="work" size={18} color={Colors.accent} />
              <Text style={styles.detailCardTitle}>Job Details</Text>
            </View>
            {JOB_INFO.map((item, index) => (
              <View
                key={item.label}
                style={[
                  styles.detailRow,
                  index < JOB_INFO.length - 1 && styles.detailRowBorder,
                ]}>
                <MaterialIcons
                  name={item.icon as any}
                  size={18}
                  color={Colors.textTertiary}
                  style={styles.detailRowIcon}
                />
                <View style={styles.detailRowContent}>
                  <Text style={styles.detailRowLabel}>{item.label}</Text>
                  <Text style={styles.detailRowValue} numberOfLines={2}>
                    {item.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Mix Info */}
          <View
            style={[
              styles.detailCard,
              styles.mixCard,
              isTablet && styles.detailCardHalf,
            ]}>
            <View style={styles.detailCardHeader}>
              <MaterialIcons name="science" size={18} color={Colors.primary} />
              <Text style={[styles.detailCardTitle, {color: Colors.primary}]}>
                Mix Details
              </Text>
            </View>
            {MIX_INFO.map((item, index) => (
              <View
                key={item.label}
                style={[
                  styles.detailRow,
                  index < MIX_INFO.length - 1 && styles.detailRowBorderGreen,
                ]}>
                <View style={styles.detailRowContent}>
                  <Text style={styles.mixLabel}>{item.label}</Text>
                  {item.isHighlight ? (
                    <View style={styles.slumpBadge}>
                      <Text style={styles.slumpBadgeText}>{item.value}</Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.detailRowValue,
                        item.isLink && styles.linkText,
                      ]}>
                      {item.value}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Refresh Status */}
        <View style={styles.refreshBar}>
          <View style={styles.refreshDot} />
          <Text style={styles.refreshText}>Last synced at 18:44</Text>
          <TouchableOpacity style={styles.refreshBtn} activeOpacity={0.7}>
            <MaterialIcons name="sync" size={16} color={Colors.primary} />
            <Text style={styles.refreshBtnText}>Sync Now</Text>
          </TouchableOpacity>
        </View>

        <View style={{height: 16}} />
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={[styles.bottomBar, {paddingBottom: insets.bottom || 8}]}>
        {BOTTOM_ACTIONS.map(item => (
          <TouchableOpacity
            key={item.label}
            style={styles.bottomBarItem}
            activeOpacity={0.6}>
            <View style={styles.bottomIconWrap}>
              <MaterialIcons
                name={item.icon as any}
                size={22}
                color={Colors.textSecondary}
              />
            </View>
            <Text style={styles.bottomLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    backgroundColor: Colors.primaryDark,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: {
    color: Colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: Colors.textOnDark60,
    fontSize: 11,
    fontWeight: '500',
  },
  ticketTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  ticketTab: {
    backgroundColor: Colors.overlay10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.overlay15,
  },
  ticketTabActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: '#52B788',
    elevation: 4,
    shadowColor: Colors.primary,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  ticketTabText: {
    color: Colors.textOnDark70,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  ticketTabTextActive: {
    color: Colors.textOnPrimary,
  },
  headerMenuBtn: {
    padding: 8,
    marginLeft: 8,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },

  // Ticket Card
  ticketCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  ticketCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 18,
    backgroundColor: Colors.primarySurface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ticketMainInfo: {
    gap: 8,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  ticketLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.5,
  },
  ticketNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primaryDark,
    letterSpacing: 0.5,
  },
  ticketOrderNum: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  ticketMeta: {
    alignItems: 'flex-end',
    gap: 8,
  },
  truckBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 6,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  truckBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  truckSubBadge: {
    backgroundColor: Colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  truckSubText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
  },
  weatherBox: {
    alignItems: 'flex-end',
    gap: 2,
  },
  weatherPlant: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.3,
  },
  weatherTemp: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  ticketCardBadges: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    justifyContent: 'flex-end',
  },
  badgeActive: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successSurface,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  badgeActiveText: {
    color: Colors.successDark,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  badgeAccount: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.warningSurface,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  badgeAccountText: {
    color: Colors.warningDark,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.3,
  },

  // Timeline
  timelineCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  timelineScroll: {
    paddingRight: 16,
  },
  timelineStep: {
    alignItems: 'center',
    width: 80,
    position: 'relative',
  },
  timelineConnector: {
    position: 'absolute',
    top: 15,
    right: '50%',
    width: 80,
    height: 2.5,
    backgroundColor: Colors.primary,
    zIndex: -1,
  },
  timelineConnectorPending: {
    backgroundColor: Colors.border,
    height: 2,
  },
  timelineCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  timelineCircleDone: {
    backgroundColor: Colors.primary,
    elevation: 3,
    shadowColor: Colors.primary,
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  timelineCirclePending: {
    backgroundColor: Colors.background,
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  timelineStepLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  timelineStepLabelPending: {
    color: Colors.textMuted,
  },
  timelineStepTime: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
    marginTop: 2,
  },
  timelineStepTimePending: {
    color: '#CBD5E1',
    fontWeight: '600',
  },

  // Details
  detailsContainer: {
    gap: 14,
  },
  detailsContainerTablet: {
    flexDirection: 'row',
  },
  detailCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 18,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  detailCardHalf: {
    flex: 1,
  },
  mixCard: {
    backgroundColor: Colors.primarySurface,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  detailCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
    letterSpacing: 0.3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  detailRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  detailRowBorderGreen: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.primaryMuted,
  },
  detailRowIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  detailRowContent: {
    flex: 1,
  },
  detailRowLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailRowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  mixLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  linkText: {
    color: Colors.accent,
    textDecorationLine: 'underline',
  },
  slumpBadge: {
    backgroundColor: Colors.warningSurface,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
  },
  slumpBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.warningDark,
  },

  // Refresh
  refreshBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  refreshDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
    marginRight: 10,
  },
  refreshText: {
    flex: 1,
    color: Colors.textTertiary,
    fontSize: 13,
    fontWeight: '600',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primarySurface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  refreshBtnText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },

  // Bottom Bar
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    justifyContent: 'space-around',
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -4},
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  bottomBarItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  bottomIconWrap: {
    width: 40,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  bottomLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.3,
  },
});

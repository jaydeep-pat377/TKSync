import Foundation
import CoreLocation

/**
 * Reports the real iOS location authorization status.
 *
 * react-native-geolocation-service cannot tell us this. Its AuthorizationResult
 * is only `disabled | granted | denied | restricted`, and LocationUtils.swift
 * maps BOTH `.authorizedAlways` and `.authorizedWhenInUse` to `granted`. So a
 * driver who picks "While Using the App" looks fully granted to JS while iOS
 * silently stops delivering fixes the moment the app is backgrounded — every
 * shift gets a total background gap and nobody finds out.
 *
 * One method, no side effects: it never requests anything, only reads.
 */
@objc(LocationAuthModule)
class LocationAuthModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// "always" | "whenInUse" | "denied" | "restricted" | "notDetermined" | "disabled"
  @objc(getAuthorizationStatus:rejecter:)
  func getAuthorizationStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard CLLocationManager.locationServicesEnabled() else {
      resolve("disabled")
      return
    }

    let status: CLAuthorizationStatus
    if #available(iOS 14.0, *) {
      status = CLLocationManager().authorizationStatus
    } else {
      status = CLLocationManager.authorizationStatus()
    }

    switch status {
    case .authorizedAlways:    resolve("always")
    case .authorizedWhenInUse: resolve("whenInUse")
    case .denied:              resolve("denied")
    case .restricted:          resolve("restricted")
    case .notDetermined:       resolve("notDetermined")
    @unknown default:          resolve("notDetermined")
    }
  }
}

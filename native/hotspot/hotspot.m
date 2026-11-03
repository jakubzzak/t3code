// Adapted from Joel Wohlhauser's Blackbird Instant Hotspot helper.
#import <CoreLocation/CoreLocation.h>
#import <CoreWLAN/CoreWLAN.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <dlfcn.h>
#import <objc/runtime.h>
#import <signal.h>
#import <unistd.h>
#import <dispatch/dispatch.h>

@interface SFRemoteHotspotSession : NSObject
- (void)setDelegate:(id)delegate;
- (void)startBrowsing;
- (void)stopBrowsing;
- (void)enableRemoteHotspotForDevice:(id)device withCompletionHandler:(void (^)(id info))handler;
@end

@interface HotspotDelegate : NSObject
@property(strong) SFRemoteHotspotSession *session;
@property BOOL requested;
@property(strong) id info;
@property BOOL finished;
@end

static BOOL hasLease(void);

@implementation HotspotDelegate
- (void)session:(id)session updatedFoundDevices:(NSArray *)devices {
  (void)session;
  if (self.requested || devices.count == 0) return;
  if (!hasLease()) return;
  self.requested = YES;
  [self.session enableRemoteHotspotForDevice:devices.firstObject
                       withCompletionHandler:^(id info) {
                         self.info = info;
                         self.finished = YES;
                       }];
}
@end

static void timedOut(int signalNumber) {
  (void)signalNumber;
  const char message[] = "The hotspot helper timed out.\n";
  (void)write(STDERR_FILENO, message, sizeof(message) - 1);
  _exit(1);
}

static const char *leasePath = NULL;
static dispatch_source_t leaseWatch;

static BOOL hasLease(void) {
  return leasePath != NULL && access(leasePath, F_OK) == 0;
}

static int fail(NSString *message) {
  fprintf(stderr, "%s\n", message.UTF8String);
  return 1;
}

static int printJSON(id value) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  if (!json) return fail(@"The hotspot helper could not encode its result.");
  fwrite(json.bytes, 1, json.length, stdout);
  fputc('\n', stdout);
  return 0;
}

static BOOL locationAuthorized(BOOL request, NSTimeInterval wait) {
  CLLocationManager *location = [CLLocationManager new];
  if (request && location.authorizationStatus == kCLAuthorizationStatusNotDetermined) {
    [location requestWhenInUseAuthorization];
  }
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:wait];
  while (request && location.authorizationStatus == kCLAuthorizationStatusNotDetermined &&
         deadline.timeIntervalSinceNow > 0) {
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
  }
  return location.authorizationStatus == kCLAuthorizationStatusAuthorizedAlways;
}

static int status(void) {
  if (!locationAuthorized(NO, 0)) return printJSON(@{@"authorized" : @NO, @"name" : NSNull.null});
  NSString *name = [CWWiFiClient sharedWiFiClient].interface.ssid;
  return printJSON(@{@"authorized" : @YES, @"name" : name ?: NSNull.null});
}

static int scan(void) {
  // Background checks never repeatedly prompt for a permission the user declined.
  if (!locationAuthorized(NO, 0)) return printJSON(@{@"authorized" : @NO, @"names" : @[]});
  CWInterface *interface = [CWWiFiClient sharedWiFiClient].interface;
  if (!interface) return fail(@"No Wi-Fi interface is available.");
  NSSet<CWNetwork *> *networks = [interface scanForNetworksWithName:nil error:nil];
  if (!networks) return fail(@"The Wi-Fi scan failed.");
  NSMutableOrderedSet<NSString *> *names = [NSMutableOrderedSet orderedSet];
  for (CWNetwork *network in networks) {
    if (network.ssid.length > 0) [names addObject:network.ssid];
  }
  return printJSON(@{@"authorized" : @YES, @"names" : names.array});
}

static int join(void) {
  if (!locationAuthorized(NO, 0)) {
    return fail(@"Allow Blackbird Hotspot in Location Services before connecting to a hotspot.");
  }
  CWInterface *interface = [CWWiFiClient sharedWiFiClient].interface;
  if (!interface || !interface.powerOn) return fail(@"Wi-Fi is turned off or unavailable.");
  if (!dlopen("/System/Library/PrivateFrameworks/Sharing.framework/Sharing", RTLD_NOW)) {
    return fail(@"Sharing.framework is unavailable.");
  }
  Class sessionClass = objc_getClass("SFRemoteHotspotSession");
  if (!sessionClass ||
      ![sessionClass instancesRespondToSelector:@selector(setDelegate:)] ||
      ![sessionClass instancesRespondToSelector:@selector(startBrowsing)] ||
      ![sessionClass instancesRespondToSelector:@selector(stopBrowsing)] ||
      ![sessionClass instancesRespondToSelector:@selector(enableRemoteHotspotForDevice:withCompletionHandler:)]) {
    return fail(@"This macOS does not support Blackbird's Instant Hotspot helper.");
  }
  HotspotDelegate *delegate = [HotspotDelegate new];
  delegate.session = [[sessionClass alloc] init];
  [delegate.session setDelegate:delegate];
  if (!hasLease()) return fail(@"Hotspot request was cancelled.");
  [delegate.session startBrowsing];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:45];
  while (!delegate.finished && deadline.timeIntervalSinceNow > 0) {
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
  }
  [delegate.session stopBrowsing];
  [delegate.session setDelegate:nil];

  if (!delegate.requested) return fail(@"No iPhone with Personal Hotspot was found nearby.");
  if (!delegate.finished) return fail(@"The iPhone did not turn on its hotspot in time.");
  id info = delegate.info;
  NSString *name = [info respondsToSelector:@selector(name)] ? [info valueForKey:@"name"] : nil;
  NSString *password =
      [info respondsToSelector:@selector(password)] ? [info valueForKey:@"password"] : nil;
  if (![name isKindOfClass:NSString.class] || name.length == 0 ||
      ![password isKindOfClass:NSString.class] || password.length == 0) {
    return fail(@"The iPhone did not share usable hotspot details.");
  }

  // Keep credentials in this process: no stdout, argv, temporary files or shell.
  NSData *ssid = [name dataUsingEncoding:NSUTF8StringEncoding];
  CWNetwork *network = nil;
  NSDate *scanDeadline = [NSDate dateWithTimeIntervalSinceNow:10];
  do {
    if (!hasLease()) return fail(@"Hotspot request was cancelled.");
    NSSet<CWNetwork *> *networks = [interface scanForNetworksWithSSID:ssid error:nil];
    for (CWNetwork *candidate in networks) {
      if ([candidate.ssidData isEqual:ssid] &&
          ([candidate supportsSecurity:kCWSecurityWPA2Personal] ||
           [candidate supportsSecurity:kCWSecurityWPA3Personal] ||
           [candidate supportsSecurity:kCWSecurityWPA3Transition]) &&
          (!network || candidate.rssiValue > network.rssiValue)) network = candidate;
    }
    if (network || scanDeadline.timeIntervalSinceNow <= 0) break;
    [NSThread sleepForTimeInterval:MIN(2, scanDeadline.timeIntervalSinceNow)];
  } while (scanDeadline.timeIntervalSinceNow > 0);
  if (!network) return fail(@"The iPhone hotspot did not appear in the Wi-Fi scan.");
  if (!hasLease()) return fail(@"Hotspot request was cancelled.");
  if (![interface associateToNetwork:network password:password error:nil]) {
    return fail(@"Could not join the iPhone hotspot.");
  }
  return printJSON(@{@"name" : name});
}

static int joinKnown(NSString *name, NSString *expectedHotspot) {
  if (!locationAuthorized(NO, 0)) {
    return fail(@"Allow Blackbird Hotspot in Location Services before returning to Wi-Fi.");
  }
  CWInterface *interface = [CWWiFiClient sharedWiFiClient].interface;
  if (!interface || !interface.powerOn) return fail(@"Wi-Fi is turned off or unavailable.");
  if (![interface.ssid isEqualToString:expectedHotspot]) {
    return fail(@"The current Wi-Fi network changed; the return request was cancelled.");
  }
  NSData *ssid = [name dataUsingEncoding:NSUTF8StringEncoding];
  CWNetworkProfile *profile = nil;
  for (CWNetworkProfile *candidate in interface.configuration.networkProfiles) {
    if ([candidate.ssidData isEqual:ssid]) {
      profile = candidate;
      break;
    }
  }
  if (!profile) return fail(@"The requested Wi-Fi network is not a saved network.");
  switch (profile.security) {
    case kCWSecurityNone:
    case kCWSecurityWEP:
    case kCWSecurityWPAPersonal:
    case kCWSecurityWPAPersonalMixed:
    case kCWSecurityWPA2Personal:
    case kCWSecurityPersonal:
    case kCWSecurityWPA3Personal:
    case kCWSecurityWPA3Transition:
    case kCWSecurityOWE:
    case kCWSecurityOWETransition:
      break;
    default:
      return fail(@"This saved network needs a manual connection, such as enterprise authentication.");
  }
  NSString *password = nil;
  if (profile.security != kCWSecurityNone && profile.security != kCWSecurityOWE &&
      profile.security != kCWSecurityOWETransition) {
    // Background failover must not open Keychain permission dialogs. A denied or
    // locked credential leaves the existing connection alone for a later retry.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    OSStatus interaction = SecKeychainSetUserInteractionAllowed(false);
#pragma clang diagnostic pop
    if (interaction != errSecSuccess) return fail(@"Cannot read saved Wi-Fi credentials without a prompt.");
    OSStatus status = CWKeychainFindWiFiPassword(kCWKeychainDomainUser, ssid, &password);
    if (status != errSecSuccess) status = CWKeychainFindWiFiPassword(kCWKeychainDomainSystem, ssid, &password);
    if (status != errSecSuccess || password.length == 0) {
      return fail(@"Saved Wi-Fi credentials are unavailable; connect to this network manually.");
    }
  }
  NSSet<CWNetwork *> *networks = [interface scanForNetworksWithSSID:ssid error:nil];
  CWNetwork *network = nil;
  for (CWNetwork *candidate in networks) {
    if ([candidate.ssidData isEqual:ssid] && [candidate supportsSecurity:profile.security] &&
        (!network || candidate.rssiValue > network.rssiValue)) network = candidate;
  }
  if (!network) return fail(@"The saved Wi-Fi network is not in range with its expected security.");
  // Recheck after the potentially slow scan and Keychain lookup. Another iPhone
  // uses the same default gateway, so gateway checks alone do not establish ownership.
  if (!hasLease()) return fail(@"Hotspot request was cancelled.");
  if (![interface.ssid isEqualToString:expectedHotspot]) {
    return fail(@"The current Wi-Fi network changed; the return request was cancelled.");
  }
  if (![interface associateToNetwork:network password:password error:nil]) {
    return fail(@"Could not return to the saved Wi-Fi network.");
  }
  return printJSON(@{@"name" : name});
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    const char *usage = "Usage: blackbird-hotspot --lease ABSOLUTE_FILE <join|scan|status|authorize|join-known SSID EXPECTED_HOTSPOT>\n";
    if (argc == 2 && strcmp(argv[1], "--help") == 0) {
      fputs(usage, stdout);
      return 0;
    }
    if (argc < 4 || strcmp(argv[1], "--lease") != 0 || argv[2][0] != '/') {
      fputs(usage, stderr);
      return 64;
    }
    NSString *mode = @(argv[3]);
    BOOL known = [mode isEqualToString:@"join-known"] && argc == 6 &&
      strlen(argv[4]) > 0 && strlen(argv[4]) <= 32 && strlen(argv[5]) > 0 && strlen(argv[5]) <= 32;
    if (!known && (argc != 4 || ![@[@"join", @"scan", @"status", @"authorize"] containsObject:mode])) {
      fputs(usage, stderr);
      return 64;
    }
    leasePath = argv[2];
    if (!hasLease()) return fail(@"Hotspot request was cancelled.");
    // LaunchServices owns this process, while Electron owns the lease. Removing
    // that file stops even a blocked scan without finding or killing a reused PID.
    leaseWatch = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
    dispatch_source_set_timer(leaseWatch, DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(leaseWatch, ^{ if (!hasLease()) _exit(1); });
    dispatch_resume(leaseWatch);
    signal(SIGALRM, timedOut);
    alarm([mode isEqualToString:@"authorize"] ? 125 : ([mode isEqualToString:@"join"] || known) ? 60 : 20);
    @try {
      if ([mode isEqualToString:@"status"]) return status();
      if ([mode isEqualToString:@"scan"]) return scan();
      if ([mode isEqualToString:@"authorize"]) {
        return printJSON(@{@"authorized" : @(locationAuthorized(YES, 120))});
      }
      if (known) return joinKnown(@(argv[4]), @(argv[5]));
      return join();
    } @catch (NSException *exception) {
      // Private framework exceptions may contain device details or credentials.
      (void)exception;
      return fail(@"The macOS hotspot service failed.");
    }
  }
}

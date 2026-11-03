// Exercise the real native return guard with stand-in radio and permission APIs.
// This executable never touches Location Services, the Keychain, or Wi-Fi.
#import <CoreLocation/CoreLocation.h>
#import <CoreWLAN/CoreWLAN.h>
#import <Foundation/Foundation.h>

static CLAuthorizationStatus authorization = kCLAuthorizationStatusAuthorizedAlways;
static BOOL deferredAuthorization = NO;
@interface TestLocationManager : NSObject
@property(readonly) CLAuthorizationStatus authorizationStatus;
@property(nonatomic, weak) id<CLLocationManagerDelegate> delegate;
- (void)requestWhenInUseAuthorization;
@end
@implementation TestLocationManager
- (CLAuthorizationStatus)authorizationStatus { return deferredAuthorization ? kCLAuthorizationStatusNotDetermined : authorization; }
- (void)setDelegate:(id<CLLocationManagerDelegate>)delegate {
  _delegate = delegate;
  dispatch_async(dispatch_get_main_queue(), ^{
    deferredAuthorization = NO;
    [delegate locationManagerDidChangeAuthorization:(CLLocationManager *)self];
  });
}
- (void)requestWhenInUseAuthorization { fputs("authorization-waiting\n", stderr); fflush(stderr); }
@end

@interface TestNetwork : NSObject
@property(strong) NSData *ssidData;
@property NSInteger rssiValue;
- (BOOL)supportsSecurity:(CWSecurity)security;
@end
@implementation TestNetwork
- (BOOL)supportsSecurity:(CWSecurity)security { return security == kCWSecurityNone; }
@end

@interface TestInterface : NSObject
@property(strong) NSString *ssid;
@property BOOL powerOn;
@property(strong) CWConfiguration *configuration;
@property(strong) NSString *switchDuringScan;
@property(strong) NSString *removeLeaseDuringScan;
@property NSInteger scanCount;
@property NSInteger associationCount;
- (NSSet<CWNetwork *> *)scanForNetworksWithSSID:(NSData *)ssid error:(NSError **)error;
- (BOOL)associateToNetwork:(CWNetwork *)network password:(NSString *)password error:(NSError **)error;
@end
@implementation TestInterface
- (NSSet<CWNetwork *> *)scanForNetworksWithSSID:(NSData *)ssid error:(NSError **)error {
  (void)error;
  self.scanCount++;
  if (self.switchDuringScan) self.ssid = self.switchDuringScan;
  if (self.removeLeaseDuringScan) [[NSFileManager defaultManager] removeItemAtPath:self.removeLeaseDuringScan error:nil];
  TestNetwork *network = [TestNetwork new];
  network.ssidData = ssid;
  return [NSSet setWithObject:(CWNetwork *)network];
}
- (BOOL)associateToNetwork:(CWNetwork *)network password:(NSString *)password error:(NSError **)error {
  (void)network; (void)password; (void)error;
  self.associationCount++;
  return YES;
}
@end

static TestInterface *testInterface;
@interface TestWiFiClient : NSObject
@property(readonly) CWInterface *interface;
+ (instancetype)sharedWiFiClient;
@end
@implementation TestWiFiClient
+ (instancetype)sharedWiFiClient { return [TestWiFiClient new]; }
- (CWInterface *)interface { return (CWInterface *)testInterface; }
@end

#define CLLocationManager TestLocationManager
#define CWWiFiClient TestWiFiClient
#define main hotspotMain
#include "hotspot.m"
#undef main

static void resetInterface(void) {
  testInterface = [TestInterface new];
  testInterface.ssid = @"Phone";
  testInterface.powerOn = YES;
  CWMutableNetworkProfile *profile = [CWMutableNetworkProfile networkProfile];
  profile.ssidData = [@"Home" dataUsingEncoding:NSUTF8StringEncoding];
  profile.security = kCWSecurityNone;
  CWMutableConfiguration *configuration = [CWMutableConfiguration configuration];
  configuration.networkProfiles = [NSOrderedSet orderedSetWithObject:profile];
  testInterface.configuration = configuration;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) return 64;
    leasePath = argv[2];
    resetInterface();
    if (strcmp(argv[1], "waiting-authorization") == 0) {
      authorization = kCLAuthorizationStatusNotDetermined;
      const char *args[] = { "fixture", "--lease", argv[2], "authorize" };
      return hotspotMain(4, args);
    }
    if (strcmp(argv[1], "unauthorized-status") == 0) {
      authorization = kCLAuthorizationStatusDenied;
      return status();
    }
    if (strcmp(argv[1], "disconnected-status") == 0) {
      testInterface.ssid = nil;
      return status();
    }
    if (strcmp(argv[1], "connected-status") == 0) return status();
    if (strcmp(argv[1], "deferred-connected-status") == 0) {
      deferredAuthorization = YES;
      return status();
    }
    if (strcmp(argv[1], "ownership") != 0) return 64;

    testInterface.ssid = @"Other phone";
    if (joinKnown(@"Home", @"Phone") == 0 || testInterface.associationCount != 0 || testInterface.scanCount != 0) return 2;
    resetInterface();
    testInterface.ssid = nil;
    if (joinKnown(@"Home", @"Phone") == 0 || testInterface.associationCount != 0 || testInterface.scanCount != 0) return 3;
    resetInterface();
    testInterface.switchDuringScan = @"Other phone";
    if (joinKnown(@"Home", @"Phone") == 0 || testInterface.associationCount != 0 || testInterface.scanCount != 1) return 4;
    resetInterface();
    if (joinKnown(@"Home", @"Phone") != 0 || testInterface.associationCount != 1) return 5;
    resetInterface();
    testInterface.removeLeaseDuringScan = @(argv[2]);
    if (joinKnown(@"Home", @"Phone") == 0 || testInterface.associationCount != 0) return 6;
    return 0;
  }
}

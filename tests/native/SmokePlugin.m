#import <Cocoa/Cocoa.h>
// A minimal plug-in using only the public MacDown protocol, built for arm64 by native-smoke.py.
@interface MacDownRustSmokePlugin : NSObject
@end
@implementation MacDownRustSmokePlugin
- (NSString *)name { return @"Public protocol smoke test"; }
- (void)plugInDidInitialize {
    NSString *directory = [NSProcessInfo processInfo].environment[@"MACDOWN_TEST_DIR"];
    [@"initialized" writeToFile:[directory stringByAppendingPathComponent:@"plugin-init.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (BOOL)run:(NSMenuItem *)sender {
    NSString *directory = [NSProcessInfo processInfo].environment[@"MACDOWN_TEST_DIR"];
    return sender != nil && [@"ran" writeToFile:[directory stringByAppendingPathComponent:@"plugin-run.txt"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
@end

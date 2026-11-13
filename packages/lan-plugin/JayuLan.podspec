require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'JayuLan'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary', :text => 'First-party plugin of the Jayu game. All rights reserved.' }
  s.homepage = 'https://example.com/jayu'
  s.author = 'Jayu'
  s.source = { :git => 'https://example.com/jayu.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.resource_bundles = { 'JayuLanPrivacy' => ['ios/Sources/JayuLanPlugin/PrivacyInfo.xcprivacy'] }
  s.ios.deployment_target = '15.0'
  s.frameworks = 'Network'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end

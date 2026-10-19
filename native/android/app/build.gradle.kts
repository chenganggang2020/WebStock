plugins { id("com.android.application") }
android {
  namespace="org.marketreview.nativeapp"
  compileSdk=36
  defaultConfig {
    applicationId="org.marketreview.nativeapp"
    minSdk=26
    targetSdk=36
    versionCode=61
    versionName="0.61-native"
    testInstrumentationRunner="org.marketreview.nativeapp.FlowInstrumentation"
  }
  compileOptions { sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17 }
  sourceSets["main"].assets.srcDirs("../../contracts")
  providers.gradleProperty("privateWatchlistDir").orNull?.let { sourceSets["main"].assets.srcDir(it) }
  buildTypes { getByName("debug") { isDebuggable=true } }
}
// v35 VWAP, auction history, group workspace and ETF host paths are wired.
tasks.withType<JavaCompile>().configureEach {
// VWAP pure model and host overlay are now connected.
// v38 CFFEX source is under root host integration, not part of a release yet.
}
dependencies {
  implementation("com.alphacephei:vosk-android:0.3.75@aar")
  implementation("net.java.dev.jna:jna:5.18.1@aar")
}
val sourceReaderAssets = tasks.register<Copy>("sourceReaderAssets") {
  from("../../desktop/douyin-snapshot.js")
  from("../../MIGRATION-STATUS.json") { rename { "migration-status.json" } }
  into(layout.buildDirectory.dir("source-reader-assets"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("source-reader-assets").get().asFile)
tasks.named("preBuild").configure { dependsOn(sourceReaderAssets) }
val etfTestAssets = tasks.register<Copy>("etfTestAssets") {
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v48/research-account/staging/assets/paper-monitor-host-fixture.json")
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v44/market/staging/evidence/qt-cache.json") { rename { "dark-stock-rank-fixture.json" } }
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v35/collection/auction-probe/golden.json") { rename { "auction-analysis-fixture.json" } }
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v33/research-account/qt-fixture.json") { rename { "portfolio-mirror-fixture.json" } }
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v30/research-account/qt-fixture.json") {
    rename { "person-method-fixture.json" }
  }
  from("../../../test/fixtures") { include("eastmoney-etf-daily-20260910.html") }
  from("../../tests/fixtures") { include("scenario-tools-v1.json", "person-method-fixture.json", "risk-settings-fixture.json", "quant-research-fixture.json", "portfolio-mirror-fixture.json", "auction-analysis-fixture.json") }
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v32/research-account/qt-fixture.json")
 { rename { "quant-research-fixture.json" } }
  from("../../../output/native-ui-design-20261010/parallel-20261012/continuation-v31/research-account/qt-fixture.json") { rename { "risk-settings-fixture.json" } }
  into(layout.buildDirectory.dir("etf-test-assets"))
}
android.sourceSets["androidTest"].assets.srcDir(layout.buildDirectory.dir("etf-test-assets").get().asFile)
tasks.configureEach { if (name == "mergeDebugAndroidTestAssets") dependsOn(etfTestAssets) }

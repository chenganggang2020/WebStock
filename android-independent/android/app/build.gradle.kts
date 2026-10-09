plugins {
    id("com.android.application")
}

android {
    namespace = "com.webstock.companion"
    compileSdk { version = release(37) { minorApiLevel = 2 } }

    defaultConfig {
        applicationId = "com.webstock.companion"
        minSdk = 26
        targetSdk = 37
        versionCode = 20261006
        versionName = "2.2.0"
        testInstrumentationRunner = "com.webstock.companion.StandaloneSmokeInstrumentation"
    }

    val signingStore = System.getenv("WEBSTOCK_ANDROID_KEYSTORE")
    val signingStorePassword = System.getenv("WEBSTOCK_ANDROID_STORE_PASSWORD")
    val signingKeyPassword = System.getenv("WEBSTOCK_ANDROID_KEY_PASSWORD")
    val signingKeyAlias = System.getenv("WEBSTOCK_ANDROID_KEY_ALIAS")
    if (!signingStore.isNullOrBlank() && !signingStorePassword.isNullOrBlank() &&
        !signingKeyPassword.isNullOrBlank() && !signingKeyAlias.isNullOrBlank()) {
        signingConfigs {
            create("webstockRelease") {
                storeFile = file(signingStore)
                storePassword = signingStorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("webstockRelease")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.work:work-runtime:2.11.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260719")
}


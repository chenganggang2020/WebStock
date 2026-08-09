plugins {
    id("com.android.application")
}

android {
    namespace = "com.webstock.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.webstock.companion"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
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
    testImplementation("junit:junit:4.13.2")
}

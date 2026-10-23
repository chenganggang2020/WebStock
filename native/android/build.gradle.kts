plugins { id("com.android.application") version "9.2.0" apply false }
allprojects { layout.buildDirectory.set(rootProject.file("../../output/native-ui-design-20261010/native-preview-build/android/${project.name}")) }

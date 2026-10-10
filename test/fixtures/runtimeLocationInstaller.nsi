; Compile-only harness. Do not execute: the included hooks reference install paths.
Unicode true
Name "WebStock runtime location hook compile check"
OutFile "..\..\output\runtime-location-hook-compile.exe"
RequestExecutionLevel admin
!include "LogicLib.nsh"
!define INSTALL_REGISTRY_KEY "Software\WebStock-QA-CompileOnly"
!include "..\..\build\installer.nsh"
Function .onInit
  !insertmacro customInit
FunctionEnd
Section
  !insertmacro customInstall
SectionEnd

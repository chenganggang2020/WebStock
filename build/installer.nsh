!macro customInit
  # Run before uninstallOldVersion: the old uninstaller removes files beside EXE.
  InitPluginsDir
  ReadEnvStr $R6 "PROGRAMDATA"
  ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R7 == ""
    ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $R7 == ""
    StrCpy $R7 $INSTDIR
  ${EndIf}
  ${If} ${FileExists} "$R7\runtime-location.json"
    ${If} $R6 == ""
      MessageBox MB_OK|MB_ICONSTOP "Cannot locate ProgramData. Upgrade stopped before removing the old version."
      Abort
    ${EndIf}
    ${If} ${FileExists} "$R6\WebStock\runtime-location.json"
      # Conservative byte comparison: even ambiguous edits require explicit recovery.
      nsExec::ExecToStack '"$SYSDIR\fc.exe" /B "$R7\runtime-location.json" "$R6\WebStock\runtime-location.json"'
      Pop $R8
      Pop $R9
      ${If} $R8 != 0
        MessageBox MB_OK|MB_ICONSTOP "Data location configurations differ or cannot be read. Upgrade stopped; preserve and reconcile the original configuration first."
        Abort
      ${EndIf}
    ${Else}
      ClearErrors
      CreateDirectory "$R6\WebStock"
      CopyFiles /SILENT "$R7\runtime-location.json" "$R6\WebStock\runtime-location.json.pending"
      IfErrors runtime_location_backup_failed
      Rename "$R6\WebStock\runtime-location.json.pending" "$R6\WebStock\runtime-location.json"
      IfErrors runtime_location_backup_failed
    ${EndIf}
    ClearErrors
    CopyFiles /SILENT "$R7\runtime-location.json" "$PLUGINSDIR\webstock-runtime-location.json"
    IfErrors runtime_location_backup_failed
  ${ElseIf} ${FileExists} "$R6\WebStock\runtime-location.json"
    ClearErrors
    CopyFiles /SILENT "$R6\WebStock\runtime-location.json" "$PLUGINSDIR\webstock-runtime-location.json"
    IfErrors runtime_location_backup_failed
  ${EndIf}
  Goto runtime_location_backup_done
  runtime_location_backup_failed:
    MessageBox MB_OK|MB_ICONSTOP "Cannot preserve the data location. Upgrade stopped before removing the old version."
    Abort
  runtime_location_backup_done:
  StrCpy $INSTDIR "D:\Program Files\WebStock"
!macroend

!macro customInstall
  # Keep compatibility with older releases on rollback as well as the new stable copy.
  ${If} ${FileExists} "$PLUGINSDIR\webstock-runtime-location.json"
    ClearErrors
    CopyFiles /SILENT "$PLUGINSDIR\webstock-runtime-location.json" "$INSTDIR\runtime-location.json"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Cannot restore the runtime location. Do not launch; the preserved copy is in ProgramData/WebStock."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

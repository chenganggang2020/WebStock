#pragma once
#include <QFileInfo>
#include <QSettings>
namespace collectionEngineConfig {
// Both manual recognition and explicit source runs use the same installed
// defaults. An explicit setting (including empty/invalid) is never overwritten.
inline QString python(QSettings& settings){
 const QString installed="D:/WebstockRuntime/runtime/python/Scripts/python.exe";
 return settings.value("asr/python",QFileInfo::exists(installed)?installed:QString()).toString();
}
inline QString model(QSettings& settings){
 const QString installed="D:/WebstockRuntime/releases/WebStockData/asr-models/faster-whisper-small";
 return settings.value("asr/model",QFileInfo::exists(installed+"/model.bin")?installed:QString()).toString();
}
}

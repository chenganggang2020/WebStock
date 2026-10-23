#pragma once
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QStringList>
#include <stdexcept>

namespace stockLocalData {
namespace detail {
inline void require(bool ok,const QString&message){
    if(!ok)throw std::runtime_error(message.toUtf8().constData());
}

// Qt validates JSON syntax. This flat two-string check also rejects duplicate
// member names that QJsonDocument would otherwise silently replace.
inline bool twoStringMembers(const QByteArray&bytes){
    qsizetype at=0;
    auto space=[&]{while(at<bytes.size()&&(bytes[at]==' '||bytes[at]=='\t'||bytes[at]=='\r'||bytes[at]=='\n'))++at;};
    auto take=[&](char expected){space();if(at>=bytes.size()||bytes[at]!=expected)return false;++at;return true;};
    auto string=[&]{
        if(!take('"'))return false;
        while(at<bytes.size()){
            const char value=bytes[at++];
            if(value=='"')return true;
            if(value=='\\'){if(at>=bytes.size())return false;++at;}
        }
        return false;
    };
    if(!take('{'))return false;
    for(int member=0;member<2;++member){
        if(!string()||!take(':')||!string())return false;
        if(member==0&&!take(','))return false;
    }
    if(!take('}'))return false;
    space();return at==bytes.size();
}
}

inline QString resolve(const QString&applicationDirectory,const QString&defaultDataDirectory){
    const QString path=QDir(applicationDirectory).filePath("stock-data-root.json");
    const QFileInfo configInfo(path);
    if(!configInfo.exists()&&!configInfo.isSymLink())return defaultDataDirectory;
    const QString context="数据目录配置 "+path+"：";
    detail::require(configInfo.isFile()&&!configInfo.isSymLink(),context+"必须是普通配置文件");
    QFile config(path);
    detail::require(config.open(QIODevice::ReadOnly),context+"无法只读打开");
    constexpr qint64 limit=16*1024;
    detail::require(config.size()>0&&config.size()<=limit,context+"必须为1至16384字节");
    const QByteArray bytes=config.read(limit+1);
    detail::require(config.error()==QFileDevice::NoError&&bytes.size()==config.size()&&bytes.size()<=limit,context+"未完整读取或超过16KiB");
    config.close();
    detail::require(QString::fromUtf8(bytes).toUtf8()==bytes,context+"不是有效UTF-8");
    QJsonParseError error;
    const auto document=QJsonDocument::fromJson(bytes,&error);
    detail::require(error.error==QJsonParseError::NoError&&document.isObject()&&detail::twoStringMembers(bytes),context+"必须为无重复字段的完整JSON对象");
    const auto object=document.object();
    detail::require(object.keys()==QStringList{"directory","schema"}&&object.value("schema")=="stock-local-data-root/v1"&&object.value("directory").isString(),context+"只允许schema与directory，且schema须为stock-local-data-root/v1");
    const QString directory=object.value("directory").toString();
    detail::require(!directory.isEmpty()&&!directory.contains(QChar(0))&&QString::fromUtf8(directory.toUtf8())==directory,context+"目录字符串无效");
    const QFileInfo directoryInfo(directory);
    detail::require(directoryInfo.isNativePath()&&directoryInfo.isAbsolute()&&directoryInfo.isDir(),context+"directory必须为绝对路径的现有目录");
    const QString canonical=directoryInfo.canonicalFilePath();
    detail::require(!canonical.isEmpty(),context+"目录无法解析为规范路径");
    const QFileInfo businessInfo(QDir(canonical).filePath("business-v1.sqlite"));
    detail::require(businessInfo.isFile()&&!businessInfo.isSymLink(),context+"目录中缺少普通文件business-v1.sqlite");
    QFile business(businessInfo.filePath());
    detail::require(business.open(QIODevice::ReadOnly),context+"business-v1.sqlite无法只读打开");
    return canonical;
}
}

#pragma once
#include "request_authorization_widget.hpp"
#include <QTest>
#include <QTemporaryDir>
#include <QTextStream>
#include <cstring>
class Reply:public QNetworkReply {
 QByteArray body;int offset=0;
public:
 Reply(QNetworkRequest request,QByteArray data,QObject*parent,bool hold=false):QNetworkReply(parent),body(std::move(data)){setRequest(request);setUrl(request.url());setOperation(QNetworkAccessManager::PostOperation);setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);setHeader(QNetworkRequest::ContentTypeHeader,"application/json");setHeader(QNetworkRequest::ContentLengthHeader,body.size());open(QIODevice::ReadOnly);if(!hold)QTimer::singleShot(0,this,[this]{emit readyRead();setFinished(true);emit finished();});}
 void abort()override{setFinished(true);}
 qint64 bytesAvailable()const override{return body.size()-offset+QNetworkReply::bytesAvailable();}
 bool isSequential()const override{return true;}
 qint64 readData(char*data,qint64 size)override{int n=qMin<qint64>(size,body.size()-offset);if(n<=0)return -1;std::memcpy(data,body.constData()+offset,n);offset+=n;return n;}
};
class Transport:public QNetworkAccessManager {
public:
 int sent=0;QByteArray wire;bool headerValid=false;QByteArray content="fixture report";bool echo=false,hold=false;
 QNetworkReply*createRequest(Operation operation,const QNetworkRequest&r,QIODevice*out)override{++sent;wire=out?out->readAll():QByteArray();headerValid=r.rawHeader("Authorization")=="Bearer synthetic-fixture-secret-0123456789";QJsonObject message{{"role","assistant"},{"content",QString::fromUtf8(echo?QByteArray("synthetic-fixture-secret-0123456789"):content)}};return new Reply(r,aiKnowledge::bytes(QJsonObject{{"object","chat.completion"},{"id","local"},{"model","fixture-model"},{"created",1},{"choices",QJsonArray{QJsonObject{{"index",0},{"finish_reason","stop"},{"message",message}}}}}),this,hold);}
};

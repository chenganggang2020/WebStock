#pragma once
#include <QCoreApplication>
#include <QThreadPool>

// Each page also bounds admission to one running and one latest request.
inline QThreadPool* nativeReadPool() {
 static auto* pool=[] {auto* p=new QThreadPool(QCoreApplication::instance());p->setMaxThreadCount(2);return p;}();
 return pool;
}

#pragma once
#include "market_store.hpp"
#include "native_read_pool.hpp"
#include <QCoreApplication>
#include <QEvent>
#include <QPointer>
#include <QThreadPool>
#include <QTimer>
#include <QWidget>
#include <functional>
#include <stdexcept>

// Page-owned reader: one running request and only the latest replacement.
// No widgets, feed objects or SQL connections are accessed on the worker.
class CapitalArchiveReader final : public QObject {
 public:
  using Complete = std::function<void(QString, QString, QJsonObject, QString)>;
  CapitalArchiveReader(QWidget* page, QString file, Complete complete)
      : QObject(page), page(page), file(std::move(file)), complete(std::move(complete)) {
    page->installEventFilter(this);
  }
  std::function<void()> shown;
  void request(QString id, QString date) {
    if (!page->isVisible()) return;
    latestId = std::move(id); latestDate = std::move(date); ++serial; pending = true;
    dispatch();
  }
 protected:
  bool eventFilter(QObject*, QEvent* e) override {
    if (e->type() == QEvent::Hide) { ++serial; pending = false; }
    if (e->type() == QEvent::Show)
      QTimer::singleShot(0, this, [this] { if (page->isVisible() && shown) shown(); });
    return false;
  }
 private:
  QWidget* page;
  QString file, latestId, latestDate;
  Complete complete;
  quint64 serial = 0;
  bool busy = false, pending = false;
  void dispatch() {
    if (busy || !pending || !page->isVisible()) return;
    pending = false; busy = true;
    const auto token = serial;
    const auto id = latestId, date = latestDate, path = file;
    QPointer<CapitalArchiveReader> owner(this);
    auto* app = QCoreApplication::instance();
    nativeReadPool()->start([owner, app, token, id, date, path] {
      QJsonObject data; QString error;
      try { data = MarketStore(path).capitalArchive(id, date); }
      catch (const std::exception& e) { error = QString::fromUtf8(e.what()); }
      QMetaObject::invokeMethod(app, [owner, token, id, date, data, error] {
        if (!owner) return;
        owner->busy = false;
        if (owner->serial == token && owner->page->isVisible())
          owner->complete(id, date, data, error);
        if (owner) owner->dispatch();
      }, Qt::QueuedConnection);
    });
  }
};

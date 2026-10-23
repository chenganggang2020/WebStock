#pragma once
#include "local_candidate_background_adapter.hpp"
#include "candidate_theme_selection.hpp"
#include "candidate_business_selection.hpp"
#include <QStringList>
namespace candidateBackgroundHost {
inline const QString schema="native-candidate-background-host/v1";
// Explicit paths only; constructing this bridge performs no I/O.
struct Paths {QString business,recent,leaders,evidence;};
struct Hooks {std::function<QDateTime()> now;std::function<void()> betweenReads;std::function<void()> beforeCommit;}; // isolated checks only
void verify(const QJsonObject& bundle,const localCandidate::Cancel& cancelled={});
class Host final {
 public:
  explicit Host(Paths paths,Hooks hooks={}):paths(std::move(paths)),hooks(std::move(hooks)){}
  QJsonArray accounts(const localCandidate::Cancel& cancelled={})const;
  QJsonObject capture(const QJsonArray& selected,const QString& strategy,const QStringList& accountIds,const localCandidate::Cancel& cancelled={})const;
  QJsonObject themeCatalogue(const localCandidate::Cancel& cancelled={})const;
  QJsonObject prepare(const QJsonArray& selected,const QString& strategy,const QStringList& accountIds,const QJsonObject& themeSelection,const localCandidate::Cancel& cancelled={})const;
  QJsonObject prepareBusiness(const QJsonArray& selected,const QString& strategy,const QStringList& accountIds,const QJsonObject& themeSelection,const QJsonObject& businessSelection,const localCandidate::Cancel& cancelled={})const;
  QJsonObject completePreview(const QJsonObject& preview,const localCandidate::Cancel& cancelled={})const;
  QString head(const localCandidate::Cancel& cancelled={})const;
  QString putDraft(const QJsonObject& bundle,const QString& expectedHead,const localCandidate::Cancel& cancelled={})const;
  QJsonObject readDraft(const QString& anchor,const localCandidate::Cancel& cancelled={})const;
  QString save(const QString& title,const QJsonObject& bundle,const QDateTime& now,const localCandidate::Cancel& cancelled={})const;
  QJsonArray list(const localCandidate::Cancel& cancelled={})const;
  QJsonObject read(const QString& id,const localCandidate::Cancel& cancelled={})const;
  void remove(const QString& id,const QString& expectedDigest,const localCandidate::Cancel& cancelled={})const;
 private:Paths paths;Hooks hooks;
};
}

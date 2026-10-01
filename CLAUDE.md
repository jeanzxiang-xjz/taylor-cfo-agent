# 项目规则

- 改完代码后不要自动 `git commit` / `git push`。先让用户人工验收效果，
  用户明确说「提交」或「push」之后，才可以提交并推送。
  注意本分支 `jeanzxiang-xjz/cloud-deploy-tyler` 的上游是私有仓库 `taylor`，
  不是 `origin`（公开仓库 my-cfo-agent）——`git push` 默认进 taylor。
- 派给子代理（Agent/Task）做验证性、只读性质的工作时，不要给它 git 提交/推送权限，避免它越权提交。

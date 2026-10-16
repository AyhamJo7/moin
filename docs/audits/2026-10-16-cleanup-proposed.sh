#!/usr/bin/env bash
# PROPOSED moin cleanup — generated 2026-10-16 by the state audit. NOT EXECUTED.
# Read docs/audits/2026-10-16-state-audit.md §15–§16 first. Run each STEP by hand, in order,
# from your own shell (session hooks block several of these commands on purpose).
# Every removal re-checks the HEAD recorded by the audit and refuses if it moved.
echo "This file is a reference. Copy one STEP at a time into your shell."; exit 1

set -euo pipefail
REPO=/home/adam/projects/business/moin
ARCH="$HOME/archives/moin/2026-10-16"

# STEP 0 — stop every agent session first (tmux: claude, codex, opencode, agy) and confirm none
# has its cwd inside a worktree:
for p in $(pgrep -f "claude|codex|opencode|agy"); do readlink /proc/$p/cwd; done | sort -u

# STEP 1 — archive per-worktree gate evidence (9,337 files, ~133 MB; cited by EV records).
#          `git worktree remove` deletes .git/worktrees/<name>/ including claude-evidence/.
mkdir -p "$ARCH"
tar -C "$REPO/.git" -czf "$ARCH/claude-evidence.tgz" claude-evidence $(cd "$REPO/.git" && ls -d worktrees/*/claude-evidence)
sha256sum "$ARCH/claude-evidence.tgz" > "$ARCH/claude-evidence.tgz.sha256"
tar -tzf "$ARCH/claude-evidence.tgz" | wc -l   # expect >= 9377

# STEP 2 — preserve the uncommitted, unique work (nothing else in any worktree is unique).
mkdir -p "$ARCH/uncommitted"
W=$REPO/.claude/worktrees
git -C "$W/docs+qg-09-plan" diff -- .claude/tests/test_control_plane.py > "$ARCH/uncommitted/control-plane-test-fix.patch"   # identical in 51 worktrees
cp "$W/docs+qg-09-plan/.claude/tests/test_fixture_copy.py" "$ARCH/uncommitted/"
git -C ~/projects/business/moin-awsorg diff -- PROGRESS.md > "$ARCH/uncommitted/moin-awsorg-PROGRESS-blockers.patch"
cp ~/projects/business/moin-awsorg/docs/control-plane/patches/0005-merge-grant.md "$ARCH/uncommitted/"
git -C "$W/feat-p07-12-search" diff -- PROGRESS.md > "$ARCH/uncommitted/feat-p07-12-search-PROGRESS-blocker.patch"
cp "$W/fix+qg09-s2-lock-order/docs/phases/P06-s2-lock-order-plan.md" "$ARCH/uncommitted/"
cp -r "$REPO/.omo" "$ARCH/uncommitted/omo"
cp ~/projects/business/moin-merge-order.md "$ARCH/uncommitted/"
# Stashes (26) live in the shared repo and survive worktree removal; export them anyway:
n=$(git -C "$REPO" stash list | wc -l); for i in $(seq 0 $((n-1))); do git -C "$REPO" stash show -p --include-untracked "stash@{$i}" > "$ARCH/uncommitted/stash-$i.patch" || true; done
git -C "$REPO" stash list > "$ARCH/uncommitted/stash-list.txt"

# helper: remove a worktree only if HEAD still equals the audited commit
rmwt() { local p="$1" want="$2" force="${3:-}"; local h; h=$(git -C "$p" rev-parse HEAD) || return 1;
  if [ "$h" != "$want" ]; then echo "SKIP moved: $p ($h != $want)"; return 0; fi
  git -C "$REPO" worktree remove $force "$p" && echo "removed $p"; }

# STEP 3 — 256 clean worktrees whose HEAD equals or is contained in a merged PR head / main.
#          No --force: git itself refuses if anything became dirty since the audit.
rmwt '/home/adam/projects/business/moin-abuse' ba7f026b4b3af4ade9de9600d9d227f95e360e85   # feat/p06-12-abuse #47M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-audit' ad03ae6cd2e95fb3d376d2659c33d43d22ff8f8d   # feat/p06-10-audit #31M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-auditw' 6576bb7d401de03e4f21210fb9ec2977edc98863   # feat/p06-10-03-adoption #45M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-csrf' c0896608c95f799ef58fe974c0dd65d307831bbe   # feat/p06-06-csrf #40M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-ctl' 4b888fe3caece324bd78bb4189e37aecbc0af64b   # fix/p02-06-secret-rule #25M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-ctx' 43870480833e7be5c97f5ec3bffe7c4088e00588   # feat/p06-03-tenant-context #28M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-gates' 96a70c2aa018960c89b4a7755dae9882a1c6347a   # chore/p02-02-qg01-gates #15M IN_MAIN
rmwt '/home/adam/projects/business/moin-integration' e419c1cc93ed87d205f52df7727d5fbf9fc2afa8   # chore/p04-11-stack-integration #18M IN_MAIN
rmwt '/home/adam/projects/business/moin-invite' 32ec1dcdccc39c99a5d9f0fd4d2d9d0dd2c75d05   # feat/p06-08-invitations #43M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-lifecycle' 4df8ee94b787e56f3958e753cd5b0412b8fe47d6   # feat/p06-06-lifecycle #41M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-maintenance' 028ae9d3dcf09970e8607aa2b113be3ac20857ac   # chore/p00-02-evidence-bookkeeping #17C IN_MAIN
rmwt '/home/adam/projects/business/moin-nc' 2e16a5178bd2c52cfa49e2a892069c8af7d5d499   # docs/p02-01-ruleset-evidence #26M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-p04' 8b9fc13e9861184b606ec593e2063f8dc8d3525d   # feat/p04-04-voice-adapter #16M IN_MAIN
rmwt '/home/adam/projects/business/moin-p06' cc0fcc4a36cf1818a6eb965ac3860f61ac59b929   # feat/p06-01-roles-and-rls #27M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr109' cd72007ac35b1b190aa3a074d2acab602957d13a   # fix/p08-03-merge-main #109M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr110' e1b7c6670fd17253a23148294a598d110348f551   # fix/p08-04-merge-main #110M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr111' 5b2efc11b10ef5f89572c9727c0b74ccea12ff34   # fix/p08-05-merge-main #111M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr112' 056ac5b6364bd69f461b39a6b5e8fcc8cae92e1a   # fix/p08-06-merge-main #112M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr113' 5ad6a7691da47a0867fde6723a5c8af9fb89ee88   # fix/p08-07-merge-main #113M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr114' 26f8c1e5a9d5cab84206742e16491a5652acdfe0   # fix/p08-08-merge-main #114M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr115' 43043e5949e2cf2ff72c3182d3c58758277088a0   # fix/p08-09-merge-main #115M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr116' d0feb3e43dfa6d9abe49dc80c7e4e33ac11ead3f   # fix/p08-10-merge-main #116M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr117' f63b8758c49ec5fb74900d3131b24bce13c13d14   # fix/p08-11-merge-main #117M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr118' f31ad7616a217c934d201e78d6f9a41fdba6e6e4   # fix/p10-01-merge-main #118M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr119' 6300d819c1f525d652b388521d91cd19dcef766d   # fix/p10-03-merge-main #119M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr120' 3d37358993d8fc52890a02fe2c09be0aea071915   # fix/p10-04-merge-main #120M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr121' 952c2e7a50a3f22e80778f4cdf8b3971f9dfb2aa   # fix/p10-05-merge-main #121M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr122' 6f8b41c045df71652922b500c5bd970e5da41057   # fix/p10-06-merge-main #122M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr123' 1726a583bef0afc26c84f191db976a1beaa2857e   # fix/p10-07-merge-main #123M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr124' 316767745c6218b1ad8b844195b6c6077ec09f63   # fix/p10-08-merge-main #124M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr125' 3ef07fb2e7e2dfff0f6722a6a682db4b9449b023   # fix/p10-09-merge-main #125M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr126' 226ae469373fc5835ad647dc5bddeb3d0f9a0162   # fix/p10-10-merge-main #126M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr127' aad86632dc1b290f5b3a5d7e77e760ac47330d52   # fix/p10-11-merge-main #127M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr128' a91fe9b6ad19dc8aadfeafb43d3a369ff5ad5a60   # fix/p10-12-merge-main #128M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr129' 7141e9b9848c33e9e940224176464d5a480efeca   # fix/p10-13-merge-main #129M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr130' 93debf71f99488ec092a7f5a45aaa0aa8b06ccea   # fix/p10-14-merge-main #130M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr131' fc8d50b4f238dfce88cec2c051faa8d8701c86f0   # fix/p11-01-merge-main #131M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr132' 624fcbf05a338a9ed82eb2aca63df17e93baedb4   # fix/p11-02-merge-main #132M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr133' d66411bdf904ce48df758bc33bc316d4e16ee9fc   # fix/p11-03-merge-main #133M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr134' cfa7df762e485b57c31291ce27346189511ca3ed   # fix/p11-04-merge-main #134M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr135' aaa3e8ce8965b6486071ad991b8e287fa500d81f   # fix/p11-05-merge-main #135M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr136' 98c599f282234665893f0246e1d62b0270585fef   # fix/p11-06-merge-main #136M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr137' 12f2769a30f26c4410053a2bba178ac13a079ef6   # fix/p11-07-merge-main #137M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr138' 9d30ccd3aff26bc5b1ab02a22cf24663a66ed2fd   # fix/p11-08-merge-main #138M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr139' 26817be90373fa5ae031893c7e6ca22d4991fdfd   # fix/p11-09-merge-main #139M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr140' f444397752380cb077db00117a4effe85a35e361   # fix/p11-11-merge-main #140M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr141' 732e44df0134b18d2e6db8f5687eb1a88f934ca6   # fix/p11-12-merge-main #141M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr142' 50930c625bde1d3791d04f588163bb64593c849b   # fix/p11-13-merge-main #142M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr143' 7e42bc8f9b40717f5bc3d27c62e3f6509bf83dd4   # fix/p11-14-merge-main #143M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr144' c76b2681d34c1e24506e1c2a2f455e74ac89ebef   # fix/p11-15-merge-main #144M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr145' 84d00dbb741cb75135d607474e55710431989a14   # fix/p11-16-merge-main #145M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr146' b0172b08665ff5b3965aa2d233a57ebc2fdd60b0   # fix/p11-18-merge-main #146M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr147' 601bcb1bc6b3e982dc08a58b9efb5e3138372fb4   # fix/p12-01-merge-main #147M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr148' 513750e2fdd44ddf5ca97c393cf067cdb9d5f2d0   # fix/p12-02-merge-main #148M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr149' bb78ce10a97b9f9cafae6620a666f12ba0a9f8a2   # fix/p12-03-merge-main #149M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr150' a986d58929b8ede9dad318d048582a9c82820cba   # fix/p12-04-merge-main #150M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr151' f1baf9ba44cfbd4afe770849ad273f55faf5ec9b   # fix/p12-05-merge-main #151M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr152' f5084e6336e3467c36f0880f8150fc808a82a3a9   # fix/p12-06-merge-main #152M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr153' f2da0fcd15943a7dbbe6595ea761dc752f8cdbae   # fix/p12-07-merge-main #153M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr154' 1f8fb5f72fd5b5d4803042c21047bf03972747ff   # fix/p12-08-merge-main #154M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr155' 25c4cdd138b0d4eec7c002c7ac993fa17fa4c0e0   # fix/p12-09-merge-main #155M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr156' 95f58694ccb91ed2539fcd1c508898cf77efc2e0   # fix/p12-10-merge-main #156M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr157' 0f3c2bbc2d89e76cdb245310baceb13cebdf7b39   # fix/p13-01-merge-main #157M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr158' b0e44a9584b5d63147017ba32e9d9726380bbd6c   # fix/p13-02-merge-main #158M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr159' 50ddc8cedd426ef161e60e3521d1569158b99642   # fix/p13-03-merge-main #159M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr160' 6ab646457a043c7ad0efc9d88f7263d4b512d26f   # fix/p13-04-merge-main #160M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr161' a650bfd9be9f63b0767ef0e28e2111a2b46de9ae   # fix/p13-05-merge-main #161M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr162' 6684f6db78250841d0baaadd341b6b3858266b1b   # fix/p13-06-merge-main #162M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr163' 47015d1a04dad7f1feed5dbef7a3b49a24ab5def   # fix/p13-08-merge-main #163M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr164' dfa0d6138161b01fdb94f07c16e0056b5f669c48   # fix/p13-09-merge-main #164M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr165' 994e00144bf48f42afa3b7eccbad8f4d69df6b10   # fix/p13-10-merge-main #165M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr166' e4f5f9363c4e396749665b5b098e147a4e9b998e   # fix/p13-11-merge-main-2 #166M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr167' d7a307dca351f1308293364133591ac522e6f523   # fix/p13-12-merge-main #167M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr168' 18c04d43718767ce08c0e122ce3987ae1da3476f   # fix/p13-13-merge-main #168M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr169' 663178924f10f884d4fdb7f7113da4dbe9ff817a   # fix/p14-01-merge-main #169M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr170' bd297cea8b3145e9a8eb0de2463a70bba1bbcc74   # fix/p14-05-merge-main #170M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr171' 5111a80e23fd759b767cbacf2262006aadd5f2b5   # fix/p14-07-merge-main #171M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr172' 13edb1dc38e46ce41d8ee6fbbac399ec0134b2d0   # fix/p14-08-merge-main #172M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr173' 96f1e8355dba2eb93791d829aa30b1f148c8511e   # fix/p15-01-merge-main #173M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr174' f4d32ac93f9b14c1e2ded8eb9c56325124a531cd   # fix/p15-02-merge-main #174M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr175' 5b99993fa8571614bfb22bd0813a4f94ef14ffb5   # fix/p15-04-merge-main #175M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr176' 79f8617ac0cba014833eb7db96b63ec691799424   # fix/p15-05-merge-main #176M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr177' 6a43153800c969445d12ddc39383a44560c6ee9a   # fix/p05-01-merge-main #177M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr178' 8b3fa1eafa52e79b58bb78b7757cc196f841e8bc   # fix/p15-06-merge-main #178M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr179' 1b7558dd026ad32c61f24d58dc4237b1a0b9e121   # fix/p15-07-merge-main #179M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr180' 80bfda248aa64656aacd059eadb77c33bbaac68b   # fix/p15-09-merge-main #180M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr181' ad6f234fd908be0d19a068402692199850d9b02e   # fix/p15-10-merge-main #181M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr182' 1cafd5c29cfec02d93c8038cc01ce3466e47873c   # fix/p15-11-merge-main #182M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr183' 8e0e7d99e088ecd2af0208b563111b5a477e0849   # fix/p15-12-merge-main #183M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr184' 43f679209f013c8796b61a44117467d46e57147d   # fix/p16-01-merge-main #184M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr185' 9fff71413b61c1b65dac3c219efae462e03fac62   # fix/p16-02-merge-main #185M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr186' d4a69bc9febb28d12f4220db6deb66e9b17bedf8   # fix/p16-04-merge-main #186M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr187' 218b17d2e3e519403beaf27b36ff6691cfaee915   # fix/p16-05-merge-main #187M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr188' 4bb36c1a986c45974027d028ee57d4f7b1b2f1a5   # fix/p16-07-merge-main #188M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr189' 27358be69ab06ad4f82d5758eb26e07e4b424d4a   # fix/p16-08-merge-main #189M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr190' 70ddcb4b269a4adc9b243a2d1122c5e7861222f1   # fix/p16-12-merge-main #190M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr191' 21c9c842eacf5601981e9fbacb2b7fe72c1aabdc   # fix/p16-13-merge-main #191M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr192' aed2f2143df5dcb8a4c2e2f8062c4167a9c2ffd6   # fix/p16-17-merge-main #192M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr193' 961e07e7118dd464c7fa44647b5e1a45dd86a38e   # fix/p17-01-merge-main #193M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr194' 1c3a6d96bf255202a8e9966332a5cc24073fe4a9   # fix/p17-02-merge-main #194M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr195' 8e6882b44906fc3f859a023e99a417763dd11192   # fix/p17-03-merge-main #195M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr196' 8b724567742d08154f34f091194c2c72346a8350   # fix/p17-04-merge-main #196M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr197' ce189af5cd93d0ed8877b125427adc4f70ede508   # fix/p17-05-merge-main #197M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr198' f0289d25c84963f38243d095ded16b9aa1f553b3   # fix/p17-06-merge-main #198M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr199' d6df3e2ef47a86ba5a30384e2e5b7c06cde8ed8f   # fix/p17-07-merge-main #199M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr200' 71b8ded1012b9ffab32f4cd67786bb1ee9c0bb6b   # fix/p17-08-merge-main #200M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr201' 26be941ddfc07db370299d17d1b47cc3d3aa61e0   # fix/p17-11-merge-main #201M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr202' 9632185316359ea10a27171111217d24a8c74e1e   # fix/p17-12-merge-main #202M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr203' 66510e1ee096d2c153d68b86ef3f21d3f9ef9e94   # fix/p18-03-merge-main #203M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr204' a045c7aa7bd7549dc8c72c6105d34d272daa5e31   # fix/p18-09-merge-main #204M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr205' 204a6668e8f03243f171dd4121a02c5c13ff8ab1   # fix/p18-10-merge-main #205M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr206' 0d53f428c6410ec7366607698c3743baf9ed7d41   # fix/p18-12-merge-main #206M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr207' 4878486534de2a8658faf2657063d0d6261c3cef   # fix/p05-03-merge-main #207M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr208' bd7efd36c47d42ab6a51d35be9550b12f2bb3c04   # fix/p05-07-merge-main #208M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr209' 92d134cd8b611ed1c5aae86df9de8c61cbc165ed   # fix/p05-09-merge-main #209M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr210' b66d1b9a57e2ba9062c1e68af337ec617d400db5   # fix/p09-0803-merge-main #210M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr211' e752c994418f5ceaca6b1d6004ac4c7a25e19834   # fix/p10-02-merge-main #211M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr212' 1a7bc891dbfe212d3b4f3c9399097f2469d4533e   # fix/p10-15-merge-main #212M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr213' 317c0438f48bbca3135c60451db9d76909ea5f50   # fix/p11-10-merge-main #213M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr214' 22d512aa94220f3cf744a5381171a77408e3f73b   # fix/p16-03-merge-main #214M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr215' 99b2dcfaa819c800d025e614ecda5d2df413f672   # fix/p16-06-merge-main #215M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr216' c30429c5382c6a294e1195f89e3e1948aa86d992   # fix/p09-0904-merge-main #216M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr217' 16c20b61670525b79a5d2ff5b67f914aed5b9b74   # fix/p20-merge-main #217M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr218' 0490a2e7b0af14c5ccecdc8714c54faa6355cfd2   # fix/p21-merge-main #218M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr219' 14326e2d0a1c9bd6c03e2070723b781f88346076   # fix/p22-merge-main #219M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr220' 66b30e942943ce89e69031a0760c795f0acf8283   # fix/p27-merge-main #220M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr221' 5ebff46ae350f9cfa5ec6ba3685ce2daa7e76d50   # fix/p28-merge-main #221M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr222' 2e3095189aac679c40e75427b3bca6c67d64e6a5   # fix/p29-merge-main #222M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr223' e6aa1c58a90f419664c958c261a144116043be0a   # fix/p30-merge-main #223M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr224' 6f97d81b55f8c2b0924fcc5e9862cda980aae214   # fix/p31-merge-main #224M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr225' d8b1974f8d2eb064171f610e671db11a80490abd   # fix/p32-merge-main #225M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-pr226' 865b4c177aeb85bfe5329a62e068981dc90ec052   # fix/p33-merge-main #226M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-prov' 9ec6e8e7f931c30608d1e1688b52904a7d0b2de4   # feat/p06-04-provisioning #29M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-rbac' c6fff1f1a9ee7e162b883daa0fee75a0025d1836   # feat/p06-07-rbac #42M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-recovery' af017510535167297698c800c7236b0cbd2a38b3   # feat/p06-09-recovery #44M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-revoke' fe8f8022baaab7ce684394259feb81226c1f531e   # feat/p06-06-revocation #39M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-stepup' 4c39b7bac7244795d8ab6e4fdbbd39f795ba15f7   # feat/p06-06-step-up-mfa #38M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-support' 4ad432dc1bc61ffd6dc99ff514093153c14a6c01   # feat/p06-11-support #46M MERGED_EXACT
rmwt '/home/adam/projects/business/moin-tctx' 2c95bbaea06a753c36d26b675c549aa402f89c02   # test/p06-03-tenant-from-session #49M MERGED_EXACT
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p05-03-terraform' 053089bfad5e9fec5c02aba0434b3f9e4a748498   # feat/p05-03-terraform #207M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p05-07-datasvc' 42bfb930d8770b8be1f1feeaab66dfabe4274182   # feat/p05-07-datasvc #208M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p05-09-pipeline' af156b8547e992f2544fc8351c4698b83cf6d17a   # feat/p05-09-pipeline #209M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-01-envelope' e3c5bf7f0e92244668822b5ed3cb8517f14824f7   # feat/p08-01-envelope #107M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-02-outbox' 259c3a8e0569dd5997db0fa8de951e87cbb8f64d   # feat/p08-02-outbox #108M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-03-inbox' bc37e3f2dc02185c56f0bbff90df12bdab5ec8b6   # feat/p08-03-inbox #109M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-04-idempotency' 69738c55b6270259566fc656d118030000b59323   # feat/p08-04-idempotency #110M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-05-worker' ec5ae5c92b779cfab2c68e15cd373758438f26cd   # feat/p08-05-worker #111M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-06-history' 713eb0e7b21d5fb05d4e03685fa5322e62384831   # feat/p08-06-history #112M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-07-timers' 7b8d08c89e3086bcb2d41d6a5494d041527a5010   # feat/p08-07-timers #113M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-08-sse' 29a384eb6f72eabf4d0a00711cc165f090e2f2d3   # feat/p08-08-sse #114M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-09-ratelimit' 2bf6bb16497a21af8da8ed283c829aca065edc86   # feat/p08-09-ratelimit #115M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-10-flags' 8096a4556c5da3d58d0dd7d3df41904cdc2ee165   # feat/p08-10-flags #116M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p08-11-chaos' 738683f5017dcdaaa5962efa5378bc9af3a1cf75   # feat/p08-11-chaos #117M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-0803-pdf' d75bbf609aa4ebb751638a8cf4b1e75ff890710d   # feat/p09-0803-pdf #210M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-0904-passages' 47a5afb7341cdead5e7cbce33f37cfc043e156c5   # feat/p09-0904-passages #216M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-11-evalset' c18502b577b217578596d9fcb5c47588becf67b8   # feat/p09-11-evalset #106M MERGED_EXACT
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-01-gateway' 9f7e079afc76142c24a03d9737f95b9b0e4e735a   # feat/p10-01-gateway #118M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-02-altprovider' bb7e51ee5d6faa49aafe91ccb192ce089978d022   # feat/p10-02-altprovider #211M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-03-structured' 359b7dafbe471757ae2fab34a9443f63ba33b259   # feat/p10-03-structured #119M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-04-resilience' dc4320af53b30795221b45c7b67aa482d78b6f0e   # feat/p10-04-resilience #120M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-05-redaction' d5146902c9fd3ca63374e090750dcaf4ffbd576b   # feat/p10-05-redaction #121M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-06-registry' 1c77ee4ab55c77da4d72fc57130cb296ff29505b   # feat/p10-06-registry #122M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-07-policy' 1f5771dadf847e6e916d75d072ba747d874f30b1   # feat/p10-07-policy #123M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-08-tools' 88d40caea2b127cfff63b7e5be4e0e3f35abcca9   # feat/p10-08-tools #124M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-09-templates' 86dcacf372e03657df63009c11ebfc1e26ccc67c   # feat/p10-09-templates #125M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-10-rules' 57f828fbc2fed63e4bcc6e593e4b3c7b6d905a09   # feat/p10-10-rules #126M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-11-lifesafety' 78d6bfd5f3a58b0b4b4edfe87c7ac01336eaaab4   # feat/p10-11-lifesafety #127M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-12-injection' b95a32163b05b752b6f6e20931972a0db87cce27   # feat/p10-12-injection #128M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-13-evalharness' 4c2fda2e70c28f7dfba4bf0a936548cdbbfbc0d9   # feat/p10-13-evalharness #129M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-14-telemetry' 3119688b43b62fd41c2ad1a8061b62ee255efaa9   # feat/p10-14-telemetry #130M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p10-15-rollout' 5b182913a1e7f0ad085c3ae0004741ea93ac5747   # feat/p10-15-rollout #212M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-01-routing' d9f44e49c42103ff0f0b93cbfa445907a362bba6   # feat/p11-01-routing #131M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-02-webhook' 2d5864f152c1f13880a2a1c186426ef1209efdab   # feat/p11-02-webhook #132M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-03-validation' 6ab8f80d549f26b96af2429b81073e761d7e0210   # feat/p11-03-validation #133M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-04-relay' cd585816479e620540da3026c86d0c5b14ca9af4   # feat/p11-04-relay #134M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-05-session' 01ef17c4a5f1d1761b26a01cafc63364fee29175   # feat/p11-05-session #135M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-06-callbacks' 5c8ea453ec4b1400d942a8d8009e5e63d3ff4b46   # feat/p11-06-callbacks #136M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-07-fallback' 2f310642308f637fc1f803c99687dcdff33b1f02   # feat/p11-07-fallback #137M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-08-degraded' dfd0eb24a4a557f5801f7a184f9564a032b4bd8b   # feat/p11-08-degraded #138M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-09-reconcile' 48cd8167fb8c549143a0c8deab5c3811904ef87d   # feat/p11-09-reconcile #139M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-10-transfer' 91fdf8203ca8497143c0d854488e0ae0a5ad7e7b   # feat/p11-10-transfer #213M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-11-callerid' 64c75788d4ede8a784c7b3bc5f0928d305161b63   # feat/p11-11-callerid #140M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-12-caps' c71b6861ae1ab8b11c29a821d16f43ca419429da   # feat/p11-12-caps #141M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-13-metering' 47e744bbc09a087c198a37932c4b489a0ed148bd   # feat/p11-13-metering #142M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-14-norecording' d67a12d7d64f6c5ab2a8419943be016309e2306f   # feat/p11-14-norecording #143M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-15-drain' 9f9eaf071e7381f327ee476fae3465b890a0afc0   # feat/p11-15-drain #144M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-16-simulator' 90748900acf43a8ec75e12db1cf2341d2ffd0f1d   # feat/p11-16-simulator #145M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p11-18-absence' b640847764b9d9ee9902d864475b4b14181a6070   # feat/p11-18-absence #146M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-01-greeting' ee16def610dcb4ac9a67f88374a225f9a488bf72   # feat/p12-01-greeting #147M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-02-intent' b876a280a429c6abd3034e524c2aebfbad320ea3   # feat/p12-02-intent #148M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-03-faqanswer' 3da7eec069282fb71082b6d4248b662189761fb2   # feat/p12-03-faqanswer #149M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-04-callback' ec1bfff5e79cca1dca5dcc7f4f24641f3d9023d6   # feat/p12-04-callback #150M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-05-lead' 3caa70556c53277370aa8db22d396df6afa3bdfe   # feat/p12-05-lead #151M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-06-appointment' 8c5888b6a158a12fc8850a83304505ca80036c48   # feat/p12-06-appointment #152M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-07-escalation' 30deecc7a01182164954a961e72ff1c3a92a866a   # feat/p12-07-escalation #153M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-08-silence' 5112c10c28c737c5d076515249228d24f7d5e62a   # feat/p12-08-silence #154M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-09-outcome' 2037b916961f96511d7163fac51de7b0c224016a   # feat/p12-09-outcome #155M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p12-10-summary' 024a9b6fb79d58afc383518da9982bf5f929f015   # feat/p12-10-summary #156M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-01-shell' f4a1516723370c18327a5691989e6a7003eeb649   # feat/p13-01-shell #157M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-02-today' f7b1683eb4f713777785cc48dc6ca621542395c9   # feat/p13-02-today #158M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-03-cards' 522c750983281a2500ffaf3b03ccd1a483cd6101   # feat/p13-03-cards #159M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-04-inbox' a4eeb28ddbc1321d36380def7f06e83d211ca45d   # feat/p13-04-inbox #160M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-05-customers' 05cb281c3832b7692c2a2cd390561aea17c057a5   # feat/p13-05-customers #161M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-06-knowledge' 2d2f961716b0e1385f69f2aa02895ca301bad7ab   # feat/p13-06-knowledge #162M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-08-settings' f35c7b1337fa4f14297c167245e116d99eb65cb0   # feat/p13-11-states #166M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-12-a11y' 7ffa60f620198aab89a8ba0a3dc1a0793af147bb   # feat/p13-12-a11y #167M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p13-13-sec' 378796f31f766babb80dbc34af26d2050372e047   # feat/p13-13-sec #168M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p14-01-model' aef24333c9ad54527b8456bdda26dccf78f025db   # feat/p14-01-model #169M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p14-05-escalation' b4410fd66a52b2bee1a3468ecf8144c35800e6bf   # feat/p14-05-escalation #170M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p14-07-delivery' abe46289065e2f97125dba58ab8318789c2be670   # feat/p14-07-delivery #171M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p14-08-canary' 9ae21ffc7697fdd533536fc999ce54e47d7228f6   # feat/p14-08-canary #172M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-01-telemetry' bba39c73b7f610f39a957325841bb2878ab4101d   # feat/p15-01-telemetry #173M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-02-metrics' ffd255a3821873917b5b60bd17097069ad7876fe   # feat/p15-02-metrics #174M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-04-alarms' 3000742b3a3790b9894936408007559550a884d9   # feat/p15-04-alarms #175M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-05-callcanary' fd162cba748dff9fddd34755063d07e6bb48a347   # feat/p15-05-callcanary #176M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-06-debugtime' ccc7ba65404c291316ac390488f6f8584050f648   # feat/p15-06-debugtime #178M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-07-opscli' 8bef34f83feef97477a3e55014386a5b51b37601   # feat/p15-07-opscli #179M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-09-runbooks' c58a7ea04adce568b483684db353b7ba5bbd51db   # feat/p15-09-runbooks #180M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-10-incident' 35f8980ac44d06f837a37b3660b8909adab8622f   # feat/p15-10-incident #181M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-11-kpi' d962184454577f9742892b4387be6a2bbaf6f9a3   # feat/p15-11-kpi #182M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p15-12-costattr' a423fe252b53dd6e3c24a8f15bc2bcb1de74b3d1   # feat/p15-12-costattr #183M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-01-retention' dd2e571bedc89de63bb89ee2e42bf90892160d3c   # feat/p16-01-retention #184M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-02-tenret' 466d535b684c63123eec07614fe0530498a61e7b   # feat/p16-02-tenret #185M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-03-export' f91d33198e8c9200fe228ccb7852f817cf52292e   # feat/p16-03-export #214M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-04-rectify' 26019d24f794c765124ee0d53baf21c23ff269c0   # feat/p16-04-rectify #186M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-05-erasure' d43a0ef3810149e4b5ea8051299b8037199f3ecf   # feat/p16-05-erasure #187M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-06-terminate' 7367b763318c2d4d24a0995e9042b30268e896f9   # feat/p16-06-terminate #215M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-07-ledger' ec94e3d70f7bcdbdb537b36f07d4cd2a1815ee93   # feat/p16-07-ledger #188M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-08-subproc' effed3379f37cec97b40873b5a07024c2634dbeb   # feat/p16-08-subproc #189M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-12-disclosure' 6a0dc1a3d56c7e4c1bc7d7c4dcd381a1c349cea3   # feat/p16-12-disclosure #190M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-13-scope' 4d0753aa8a0fd6b3df82f0e7ac75b339099be066   # feat/p16-13-scope #191M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p16-17-turnlog' 60c87173f3c7e9764262d1f6858742e51422d671   # feat/p16-17-turnlog #192M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-01-prodacct' 82dfdd4fe957306fee17ffcc06c7c37530e45a4d   # feat/p17-01-prodacct #193M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-02-hardening' d98315e3b2d3446a75d8163c6330fbc55e4e0867   # feat/p17-02-hardening #194M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-03-waf' 8894b4d08ede240a823ed28eb92aa108244da73f   # feat/p17-03-waf #195M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-04-secrets' 8727acd5c60c72d8db17b889170b70d3864d0c29   # feat/p17-04-secrets #196M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-05-backup' faad74f4a785301363263c2418b6f6bc49bef88d   # feat/p17-05-backup #197M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-06-drill' 32ddaa1c3979feaeb32813c731681784bf61e113   # feat/p17-06-drill #198M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-07-scanbase' 5046e539ffe767c93b66bef7f7c1b83179ea30a8   # feat/p17-07-scanbase #199M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-08-access' 131024bbf4e2bef6a3be4f93f2132e90b29c74ab   # feat/p17-08-access #200M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-11-drplan' 4ce7ba406991d9cb3dc58aef15886c158e354a86   # feat/p17-11-drplan #201M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p17-12-readiness' d521d9c08304616b95b477a938f94234bdc98857   # feat/p17-12-readiness #202M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p18-03-provision' 60fdc662b5c425bcf7a87859e263731d508cbd23   # feat/p18-03-provision #203M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p18-09-killswitch' 92247e6c1611819071a85837dd18902c8bab0e87   # feat/p18-09-killswitch #204M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p18-10-monitoring' 0e177a9f25a6fd5aae49ec6ff6b13ff02e5af88b   # feat/p18-10-monitoring #205M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p18-12-gate' 767d008e2bdaa827af92dc53586450a4feafd540   # feat/p18-12-gate #206M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p20-booking' 98775d5c614cf901f90044f354b6e773a805c49d   # feat/p20-booking #217M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p21-handwerk' 1cd331ac39823d88712e9560065f7860973b59e8   # feat/p21-handwerk #218M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p22-team' 990d561dd7193b2495a9e3590cfd0e2705090f10   # feat/p22-team #219M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p27-email' 38e5c5be295f68f6ed8df295e7a49c34fef02518   # feat/p27-email #220M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p28-timeline' 11a18b32664e82b7cce77ab4572babf16c6b206a   # feat/p28-timeline #221M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p29-webhooks' 7a44f5956c9b5beac2bf946c5347ed868daaff22   # feat/p29-webhooks #222M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p30-hardening' c58e4b950fad2999b1f13f7018a0c1786a13add3   # feat/p30-hardening #223M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p31-reliability' c4454c4e8fe8ecc09b05e143dd228ab64f961a74   # feat/p31-reliability #224M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p32-validation' 9e02dbc548939373b3aa6eee8556f3d70b8fa3e5   # feat/p32-validation #225M MERGED_SUBSET
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p33-sellgate' 4a5818c6da100dec687fd9f97d5e9d4f111db461   # feat/p33-sellgate #226M MERGED_SUBSET

# STEP 4 — 49 worktrees whose ONLY local change is the identical control-plane test fix
#          preserved in STEP 2. The fingerprint check refuses anything else.
rmcp() { local p="$1" want="$2"; local d u s;
  d=$(git -C "$p" diff -- .claude/tests/test_control_plane.py | md5sum | cut -c1-32)
  u=$(md5sum < "$p/.claude/tests/test_fixture_copy.py" | cut -c1-32)
  s=$(git -C "$p" status --porcelain | grep -v -e "test_control_plane.py" -e "test_fixture_copy.py" | wc -l)
  if [ "$d" = aef0856798639ea1b0a170c6441c0101 ] && [ "$u" = cb39b62fe69db0b102f8de13b81e62e7 ] && [ "$s" = 0 ]; then rmwt "$p" "$want" --force; else echo "SKIP unexpected changes: $p"; fi; }
rmcp '/home/adam/projects/business/moin/.claude/worktrees/chore+p06-13-05-tick' 9bb812b9858565dc565773f50b92c562488d250a   # chore/p06-13-05-tick #51M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+legal-licence' 8241fc0373265148c2ed1a76bbefbc31d07a3615   # docs/legal-licence #59M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+p06-03-04-annotation' c516dee53ca3e47a38870d5adb61a17d7fb03c7c   # docs/p06-03-04-annotation #58M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+p06-08-03-tick' fbd1c2f8a7990f87946dbc6a974c3971da358829   # docs/p06-08-03-tick #55M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+p06-12-01-cognito-lockout' eb6c1031076d1181069086675c7708496550dff4   # docs/p06-12-01-cognito-lockout #56M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-plan' 927fe926836ce3786a9cba0c32754e6bd6ef6083   # docs/qg-09-plan #60M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s1-3-evidence' 66e7699043507aa67e6ef01f39812d06c34626b3   # docs/qg-09-s1-3-evidence #61M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s10-throttles' f1be34dab33b839d22f4bb114dcb7fd77654b9b0   # docs/qg-09-s10-throttles #66M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s11-xsuite' c58067e620bc7c329d02bbaca4e01ed9c5755bc6   # docs/qg-09-s11-xsuite #67M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s12-tenant' d180568b66471f0046acfa7acb6401385cf94a60   # docs/qg-09-s12-tenant #68M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s13-resolver' 8dafb9bf17133c5b4ed2088c8e1e4c3c826a12cc   # docs/qg-09-s13-resolver #69M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s4-7-evidence' e2170b03d399706f493193a522745c7fa2be613f   # docs/qg-09-s4-7-evidence #62M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s8-13-evidence' 661ab033a40b51a79f35eebcb4c65ba78802b1fb   # docs/qg-09-s8-13-evidence #63M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s8-13-reviews' 009508f0409b023151f639aee637fb041a283a20   # docs/qg-09-s8-13-reviews #64M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg-09-s9-grants' 898438e5a638e3372644f315a407cbe78df3381b   # docs/qg-09-s9-grants #65M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg09-founder-verdicts' 509f8f9f5e27c04e50e614d9dc53472c818b84ed   # docs/qg09-founder-verdicts #76M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/docs+qg09-s7-closure' 1f8b7d43de90d01ecbcb295c85ad80bc79bff179   # docs/qg09-s7-closure #78M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p06-01-06-identity' f5ee57a534f606ef46fd4c9936c1f4d0bea26ed4   # feat/p06-01-06-identity #79M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p06-03-04-resolve-route' 8859b9a6248ada93d9b2d5e2ba25b809d331793c   # feat/p06-03-04-resolve-route #57M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p06-07-05-real-matrix' 57b9f02fd1b86c853107e4a4416a66a2ee5ebed4   # docs/p06-07-05-tick #53M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p06-08-03-unassign' f909ea6ef737fd4500334af52311b8456e1d7e26   # feat/p06-08-03-unassign #54M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-01-value-objects' 9e9563abfcaf78a59a38e233324da800e235ae11   # feat/p07-01-value-objects #80M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-02-contacts' 2f8b6e65b24e0ced5142b2e0ae40c7ca41f57ed2   # feat/p07-02-contacts #81M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-03-resolution' 0c9b9e03e0fbf36e251bdc60ff43c666cac1f06f   # feat/p07-03-resolution #82M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-04-merge' 3432c30568bc79a56553e78c187811c38c22af41   # feat/p07-04-merge #92M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-05-conversations' c419f2c0e56c688a62a2d7c1fbfb1c1980610489   # feat/p07-05-conversations #83M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-06-tasks' ec11fa1ec5e5582aeeec25855a7818d81481b234   # feat/p07-06-tasks #84M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-07-leads' 7276649adc71239c0cbf182ff3c6dbaaa0d8f7d3   # feat/p07-07-leads #85M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-08-appointments' 952dfee06279d1e79f04a02594bcd03664960178   # feat/p07-08-appointments #86M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-09-notes-facts' 4948619f8ef73e39448324f06e4403b0c3f934f7   # feat/p07-09-notes-facts #87M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-10-governance' 86d06d8953517eaebb4b914152cc84547a3e9317   # feat/p07-10-governance #88M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-11-finaliser' 67a3c4502d8373bdab73e669aeffeb9feb764f8d   # feat/p07-11-finaliser #89M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-13-concurrency' e7e17fc05424533bd7d83ea681554c69c271aa76   # feat/p07-13-concurrency #90M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat+p07-14-time-locale' ceeb7a60617882bd79e64aa82d899467d6d9ac16   # feat/p07-14-time-locale #91M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-01-model' 3b0749633866a73224f15587dbb2b44537ddef76   # feat/p09-01-model #96M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-02-profile' b088e069c7c3042f251a9de3ff8671de378e0f46   # feat/p09-02-profile #97M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-03-hours' a5305474194bf720c4472af2c0a41cb9d3157e68   # feat/p09-03-hours #98M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-04-faq' cbc56dae1bf5a86880c4811d9af10fc7625c3373   # feat/p09-04-faq #99M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-05-approval' 07ff5923ca1a262184e1b5a94ddbd40471abcc40   # feat/p09-05-approval #100M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-06-staleness' 534e358f8b704e519c9fdf1c0a13bcb0e9896086   # feat/p09-06-staleness #101M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-07-conflicts' 3a780b93405c6a3ec90403b1f8374d93ab510c63   # feat/p09-07-conflicts #102M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-08-import' 160b704b373fb6da8b81309baad96eb632f6f40f   # feat/p09-08-import #103M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-09-retrieval' f5b11456b66628f609d8f985b386bcdcdf042100   # feat/p09-09-retrieval #104M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/feat-p09-10-channels' 4a33a51237060b8e21901fab798006f11b6c3fcb   # feat/p09-10-channels #105M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/fix+qg09-s4-lifecycle' 6614676ca534f9db7cc5195c0df05c4def20d400   # fix/qg09-s4-lifecycle #72M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/fix+qg09-s5-rbac' 25daa51dab21a826b23bbf025b568e1f0309e630   # fix/qg09-s5-rbac #73M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/fix+qg09-s6-invitations' 0c7f6e9b53a7205f2eae45175142254bd3644e19   # fix/qg09-s6-invitations #74M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/fix+qg09-s7-recovery' 56da05ec4bcfa931683cde9aefc2812b4bfcb554   # fix/qg09-s7-recovery #75M,#77M
rmcp '/home/adam/projects/business/moin/.claude/worktrees/fix+qg09-s9-grants' 5037d380bb1ceaf91f48c8dfae46c79b3648d459   # fix/qg09-s9-grants #71M

# STEP 5 — the three worktrees with unique uncommitted notes (preserved in STEP 2). Check the archive first.
rmwt '/home/adam/projects/business/moin-awsorg' 655cf64a21594bcff37778b2695c264bf0fca781 --force   # docs/p05-01-aws-org-baseline #177M
rmwt '/home/adam/projects/business/moin/.claude/worktrees/feat-p07-12-search' ab4f9245405508afb6045780c60d25623c9482a9 --force   # feat/p07-gate-closeout #94C,#95M
rmwt '/home/adam/projects/business/moin/.claude/worktrees/fix+qg09-s2-lock-order' 934691cc0297b37a1a7f86d48c933bf28a1ee46c --force   # fix/qg09-s2-lock-order #70M

# STEP 6 — free `main` and make the control checkout the single canonical directory.
rmwt '/home/adam/projects/business/moin-main' 5e13939f8623fc56531a63deab45a2f7348c024f
git -C "$REPO" switch main && git -C "$REPO" pull --ff-only   # main is 165 commits behind origin/main
git -C "$REPO" worktree prune -v && git -C "$REPO" worktree list   # expect exactly one line

# STEP 7 — local branches. All are squash-merged, so `git branch -d` refuses; -D is used only when
#          the branch still points at the audited commit. Kept: main, backup/p06-10-audit-pre-normalize-20260930.
rmbr() { local b="$1" want="$2"; [ "$(git -C "$REPO" rev-parse "refs/heads/$b" 2>/dev/null)" = "$want" ] && git -C "$REPO" branch -D "$b" || echo "SKIP $b"; }
rmbr 'chore/p00-02-evidence-bookkeeping' 028ae9d3dcf09970e8607aa2b113be3ac20857ac   # IN_MAIN 
rmbr 'chore/p02-01-governance' d1557e81ccd6b3d0b6680f00fc1fc86baa242928   # IN_MAIN 
rmbr 'chore/p02-02-qg01-gates' 96a70c2aa018960c89b4a7755dae9882a1c6347a   # IN_MAIN 
rmbr 'chore/p02-02-toolchain' f3065928572a2c60d699f2fb26e1e60dec550be3   # IN_MAIN 
rmbr 'chore/p02-04-local-stack' dc58a03e2942d9e4244716b5f0da3fb540bf0f42   # IN_MAIN 
rmbr 'chore/p02-06-ci' dd0485e5ddc5c1b8522634577fa3361d262cedc3   # IN_MAIN 
rmbr 'chore/p02-06-negative-controls' 4ac6ec48bc8a8a58d7b0368299856f754b4a887c   # IN_MAIN 
rmbr 'chore/p04-11-stack-integration' e419c1cc93ed87d205f52df7727d5fbf9fc2afa8   # IN_MAIN 
rmbr 'chore/p04-qg-gates-final' 82d3055c06128d7635bdc1c84c0315ee305f9b9d   # IN_MAIN 
rmbr 'chore/p06-13-05-tick' 9bb812b9858565dc565773f50b92c562488d250a   # MERGED_EXACT #51
rmbr 'docs/legal-licence' 8241fc0373265148c2ed1a76bbefbc31d07a3615   # MERGED_EXACT #59
rmbr 'docs/p02-01-ruleset-evidence' 2e16a5178bd2c52cfa49e2a892069c8af7d5d499   # MERGED_EXACT #26
rmbr 'docs/p02-07-developer-docs' 90b3b4158bd11348b5048afff0034f0d290cebd5   # IN_MAIN 
rmbr 'docs/p03-01-adrs' 906b56850bb346db6642e094b217e86640696239   # IN_MAIN 
rmbr 'docs/p03-02-domain-model' 66270cbaae43e1d823fcf5cb6b36caa0117cad59   # IN_MAIN 
rmbr 'docs/p03-04-diagrams' 07ab552346a04653fb745a0cde6b23be0dc50841   # IN_MAIN 
rmbr 'docs/p03-05-threat-model' 1de8654c75ff64b9f0cc385e5b836e51e6ca442d   # IN_MAIN 
rmbr 'docs/p03-06-data-inventory' b9f29969dc70690009fb41b4b18b001b64166a1d   # IN_MAIN 
rmbr 'docs/p05-01-aws-org-baseline' 655cf64a21594bcff37778b2695c264bf0fca781   # MERGED_SUBSET #177
rmbr 'docs/p06-03-04-annotation' c516dee53ca3e47a38870d5adb61a17d7fb03c7c   # MERGED_EXACT #58
rmbr 'docs/p06-07-05-tick' 57b9f02fd1b86c853107e4a4416a66a2ee5ebed4   # MERGED_EXACT #53
rmbr 'docs/p06-08-03-tick' fbd1c2f8a7990f87946dbc6a974c3971da358829   # MERGED_EXACT #55
rmbr 'docs/p06-12-01-cognito-lockout' eb6c1031076d1181069086675c7708496550dff4   # MERGED_EXACT #56
rmbr 'docs/qg-09-plan' 927fe926836ce3786a9cba0c32754e6bd6ef6083   # MERGED_EXACT #60
rmbr 'docs/qg-09-s1-3-evidence' 66e7699043507aa67e6ef01f39812d06c34626b3   # MERGED_EXACT #61
rmbr 'docs/qg-09-s10-throttles' f1be34dab33b839d22f4bb114dcb7fd77654b9b0   # MERGED_EXACT #66
rmbr 'docs/qg-09-s11-xsuite' c58067e620bc7c329d02bbaca4e01ed9c5755bc6   # MERGED_EXACT #67
rmbr 'docs/qg-09-s12-tenant' d180568b66471f0046acfa7acb6401385cf94a60   # MERGED_EXACT #68
rmbr 'docs/qg-09-s13-resolver' 8dafb9bf17133c5b4ed2088c8e1e4c3c826a12cc   # MERGED_EXACT #69
rmbr 'docs/qg-09-s4-7-evidence' e2170b03d399706f493193a522745c7fa2be613f   # MERGED_EXACT #62
rmbr 'docs/qg-09-s8-13-evidence' 661ab033a40b51a79f35eebcb4c65ba78802b1fb   # MERGED_EXACT #63
rmbr 'docs/qg-09-s8-13-reviews' 009508f0409b023151f639aee637fb041a283a20   # MERGED_EXACT #64
rmbr 'docs/qg-09-s9-grants' 898438e5a638e3372644f315a407cbe78df3381b   # MERGED_EXACT #65
rmbr 'docs/qg09-founder-verdicts' 509f8f9f5e27c04e50e614d9dc53472c818b84ed   # MERGED_EXACT #76
rmbr 'docs/qg09-s7-closure' 1f8b7d43de90d01ecbcb295c85ad80bc79bff179   # MERGED_EXACT #78
rmbr 'feat/p02-03-skeleton' 0eea92f8d34dac4a939c1ca2b184ef7e86afbbb0   # IN_MAIN 
rmbr 'feat/p04-04-voice-adapter' 8b9fc13e9861184b606ec593e2063f8dc8d3525d   # IN_MAIN 
rmbr 'feat/p05-03-terraform' 053089bfad5e9fec5c02aba0434b3f9e4a748498   # MERGED_SUBSET #226
rmbr 'feat/p05-07-datasvc' 42bfb930d8770b8be1f1feeaab66dfabe4274182   # MERGED_SUBSET #226
rmbr 'feat/p05-09-pipeline' af156b8547e992f2544fc8351c4698b83cf6d17a   # MERGED_SUBSET #226
rmbr 'feat/p06-01-06-identity' f5ee57a534f606ef46fd4c9936c1f4d0bea26ed4   # MERGED_EXACT #79
rmbr 'feat/p06-01-roles-and-rls' cc0fcc4a36cf1818a6eb965ac3860f61ac59b929   # MERGED_EXACT #27
rmbr 'feat/p06-03-04-resolve-route' 8859b9a6248ada93d9b2d5e2ba25b809d331793c   # MERGED_EXACT #57
rmbr 'feat/p06-03-tenant-context' 43870480833e7be5c97f5ec3bffe7c4088e00588   # MERGED_EXACT #28
rmbr 'feat/p06-04-provisioning' 9ec6e8e7f931c30608d1e1688b52904a7d0b2de4   # MERGED_EXACT #29
rmbr 'feat/p06-05-04-claims-switch' d5c92c453508d2d7087a021ec74620db2b9193c5   # MERGED_EXACT #33
rmbr 'feat/p06-05-local-oidc' 08db19518d5bef01dc3933bc44091d76e2df0f7c   # MERGED_EXACT #32
rmbr 'feat/p06-06-csrf' c0896608c95f799ef58fe974c0dd65d307831bbe   # MERGED_EXACT #40
rmbr 'feat/p06-06-lifecycle' 4df8ee94b787e56f3958e753cd5b0412b8fe47d6   # MERGED_EXACT #41
rmbr 'feat/p06-06-revocation' fe8f8022baaab7ce684394259feb81226c1f531e   # MERGED_EXACT #39
rmbr 'feat/p06-06-session-foundation' 2e414198c36dfde7c8028da7386afaaf8065cde6   # MERGED_EXACT #35
rmbr 'feat/p06-06-step-up-mfa' 4c39b7bac7244795d8ab6e4fdbbd39f795ba15f7   # MERGED_EXACT #38
rmbr 'feat/p06-07-05-real-matrix' 5933944b2cbee05bc5673f46652598cdf455364a   # MERGED_EXACT #52
rmbr 'feat/p06-07-rbac' c6fff1f1a9ee7e162b883daa0fee75a0025d1836   # MERGED_EXACT #42
rmbr 'feat/p06-08-03-unassign' f909ea6ef737fd4500334af52311b8456e1d7e26   # MERGED_EXACT #54
rmbr 'feat/p06-08-invitations' 32ec1dcdccc39c99a5d9f0fd4d2d9d0dd2c75d05   # MERGED_EXACT #43
rmbr 'feat/p06-09-recovery' af017510535167297698c800c7236b0cbd2a38b3   # MERGED_EXACT #44
rmbr 'feat/p06-10-03-adoption' 6576bb7d401de03e4f21210fb9ec2977edc98863   # MERGED_EXACT #45
rmbr 'feat/p06-10-audit' ad03ae6cd2e95fb3d376d2659c33d43d22ff8f8d   # MERGED_EXACT #31
rmbr 'feat/p06-11-support' 4ad432dc1bc61ffd6dc99ff514093153c14a6c01   # MERGED_EXACT #46
rmbr 'feat/p06-12-abuse' ba7f026b4b3af4ade9de9600d9d227f95e360e85   # MERGED_EXACT #47
rmbr 'feat/p06-13-xsuite' 2f94b9e431831d3e684f81f1df00f6dfd4d9d2c7   # MERGED_EXACT #48
rmbr 'feat/p07-01-value-objects' 9e9563abfcaf78a59a38e233324da800e235ae11   # MERGED_EXACT #80
rmbr 'feat/p07-02-contacts' 2f8b6e65b24e0ced5142b2e0ae40c7ca41f57ed2   # MERGED_EXACT #81
rmbr 'feat/p07-03-resolution' 0c9b9e03e0fbf36e251bdc60ff43c666cac1f06f   # MERGED_EXACT #82
rmbr 'feat/p07-04-merge' 3432c30568bc79a56553e78c187811c38c22af41   # MERGED_EXACT #92
rmbr 'feat/p07-05-conversations' c419f2c0e56c688a62a2d7c1fbfb1c1980610489   # MERGED_EXACT #83
rmbr 'feat/p07-06-tasks' ec11fa1ec5e5582aeeec25855a7818d81481b234   # MERGED_EXACT #84
rmbr 'feat/p07-07-leads' 7276649adc71239c0cbf182ff3c6dbaaa0d8f7d3   # MERGED_EXACT #85
rmbr 'feat/p07-08-appointments' 952dfee06279d1e79f04a02594bcd03664960178   # MERGED_EXACT #86
rmbr 'feat/p07-09-notes-facts' 4948619f8ef73e39448324f06e4403b0c3f934f7   # MERGED_EXACT #87
rmbr 'feat/p07-10-governance' 86d06d8953517eaebb4b914152cc84547a3e9317   # MERGED_EXACT #88
rmbr 'feat/p07-11-finaliser' 67a3c4502d8373bdab73e669aeffeb9feb764f8d   # MERGED_EXACT #89
rmbr 'feat/p07-12-search' f155a0d75304dac58d400b2df3a58e6b6ca7ca26   # MERGED_EXACT #93
rmbr 'feat/p07-13-concurrency' e7e17fc05424533bd7d83ea681554c69c271aa76   # MERGED_EXACT #90
rmbr 'feat/p07-14-time-locale' ceeb7a60617882bd79e64aa82d899467d6d9ac16   # MERGED_EXACT #91
rmbr 'feat/p07-gate-closeout' ab4f9245405508afb6045780c60d25623c9482a9   # MERGED_EXACT #95
rmbr 'feat/p08-01-envelope' e3c5bf7f0e92244668822b5ed3cb8517f14824f7   # MERGED_SUBSET #226
rmbr 'feat/p08-02-outbox' 259c3a8e0569dd5997db0fa8de951e87cbb8f64d   # MERGED_SUBSET #226
rmbr 'feat/p08-03-inbox' bc37e3f2dc02185c56f0bbff90df12bdab5ec8b6   # MERGED_SUBSET #226
rmbr 'feat/p08-04-idempotency' 69738c55b6270259566fc656d118030000b59323   # MERGED_SUBSET #226
rmbr 'feat/p08-05-worker' ec5ae5c92b779cfab2c68e15cd373758438f26cd   # MERGED_SUBSET #226
rmbr 'feat/p08-06-history' 713eb0e7b21d5fb05d4e03685fa5322e62384831   # MERGED_SUBSET #226
rmbr 'feat/p08-07-timers' 7b8d08c89e3086bcb2d41d6a5494d041527a5010   # MERGED_SUBSET #226
rmbr 'feat/p08-08-sse' 29a384eb6f72eabf4d0a00711cc165f090e2f2d3   # MERGED_SUBSET #226
rmbr 'feat/p08-09-ratelimit' 2bf6bb16497a21af8da8ed283c829aca065edc86   # MERGED_SUBSET #226
rmbr 'feat/p08-10-flags' 8096a4556c5da3d58d0dd7d3df41904cdc2ee165   # MERGED_SUBSET #226
rmbr 'feat/p08-11-chaos' 738683f5017dcdaaa5962efa5378bc9af3a1cf75   # MERGED_SUBSET #226
rmbr 'feat/p09-01-model' 3b0749633866a73224f15587dbb2b44537ddef76   # MERGED_EXACT #96
rmbr 'feat/p09-02-profile' b088e069c7c3042f251a9de3ff8671de378e0f46   # MERGED_EXACT #97
rmbr 'feat/p09-03-hours' a5305474194bf720c4472af2c0a41cb9d3157e68   # MERGED_EXACT #98
rmbr 'feat/p09-04-faq' cbc56dae1bf5a86880c4811d9af10fc7625c3373   # MERGED_EXACT #99
rmbr 'feat/p09-05-approval' 07ff5923ca1a262184e1b5a94ddbd40471abcc40   # MERGED_EXACT #100
rmbr 'feat/p09-06-staleness' 534e358f8b704e519c9fdf1c0a13bcb0e9896086   # MERGED_EXACT #101
rmbr 'feat/p09-07-conflicts' 3a780b93405c6a3ec90403b1f8374d93ab510c63   # MERGED_EXACT #102
rmbr 'feat/p09-08-import' 160b704b373fb6da8b81309baad96eb632f6f40f   # MERGED_EXACT #103
rmbr 'feat/p09-0803-pdf' d75bbf609aa4ebb751638a8cf4b1e75ff890710d   # MERGED_SUBSET #226
rmbr 'feat/p09-09-retrieval' f5b11456b66628f609d8f985b386bcdcdf042100   # MERGED_PLUS_1 #104
rmbr 'feat/p09-0904-passages' 47a5afb7341cdead5e7cbce33f37cfc043e156c5   # MERGED_SUBSET #226
rmbr 'feat/p09-10-channels' 4a33a51237060b8e21901fab798006f11b6c3fcb   # MERGED_EXACT #105
rmbr 'feat/p09-11-evalset' c18502b577b217578596d9fcb5c47588becf67b8   # MERGED_EXACT #106
rmbr 'feat/p10-01-gateway' 9f7e079afc76142c24a03d9737f95b9b0e4e735a   # MERGED_SUBSET #226
rmbr 'feat/p10-02-altprovider' bb7e51ee5d6faa49aafe91ccb192ce089978d022   # MERGED_SUBSET #226
rmbr 'feat/p10-03-structured' 359b7dafbe471757ae2fab34a9443f63ba33b259   # MERGED_SUBSET #226
rmbr 'feat/p10-04-resilience' dc4320af53b30795221b45c7b67aa482d78b6f0e   # MERGED_SUBSET #226
rmbr 'feat/p10-05-redaction' d5146902c9fd3ca63374e090750dcaf4ffbd576b   # MERGED_SUBSET #226
rmbr 'feat/p10-06-registry' 1c77ee4ab55c77da4d72fc57130cb296ff29505b   # MERGED_SUBSET #226
rmbr 'feat/p10-07-policy' 1f5771dadf847e6e916d75d072ba747d874f30b1   # MERGED_SUBSET #226
rmbr 'feat/p10-08-tools' 88d40caea2b127cfff63b7e5be4e0e3f35abcca9   # MERGED_SUBSET #226
rmbr 'feat/p10-09-templates' 86dcacf372e03657df63009c11ebfc1e26ccc67c   # MERGED_SUBSET #226
rmbr 'feat/p10-10-rules' 57f828fbc2fed63e4bcc6e593e4b3c7b6d905a09   # MERGED_SUBSET #226
rmbr 'feat/p10-11-lifesafety' 78d6bfd5f3a58b0b4b4edfe87c7ac01336eaaab4   # MERGED_SUBSET #226
rmbr 'feat/p10-12-injection' b95a32163b05b752b6f6e20931972a0db87cce27   # MERGED_SUBSET #226
rmbr 'feat/p10-13-evalharness' 4c2fda2e70c28f7dfba4bf0a936548cdbbfbc0d9   # MERGED_SUBSET #226
rmbr 'feat/p10-14-telemetry' 3119688b43b62fd41c2ad1a8061b62ee255efaa9   # MERGED_SUBSET #226
rmbr 'feat/p10-15-rollout' 5b182913a1e7f0ad085c3ae0004741ea93ac5747   # MERGED_SUBSET #226
rmbr 'feat/p11-01-routing' d9f44e49c42103ff0f0b93cbfa445907a362bba6   # MERGED_SUBSET #226
rmbr 'feat/p11-02-webhook' 2d5864f152c1f13880a2a1c186426ef1209efdab   # MERGED_SUBSET #226
rmbr 'feat/p11-03-validation' 6ab8f80d549f26b96af2429b81073e761d7e0210   # MERGED_SUBSET #226
rmbr 'feat/p11-04-relay' cd585816479e620540da3026c86d0c5b14ca9af4   # MERGED_SUBSET #226
rmbr 'feat/p11-05-session' 01ef17c4a5f1d1761b26a01cafc63364fee29175   # MERGED_SUBSET #226
rmbr 'feat/p11-06-callbacks' 5c8ea453ec4b1400d942a8d8009e5e63d3ff4b46   # MERGED_SUBSET #226
rmbr 'feat/p11-07-fallback' 2f310642308f637fc1f803c99687dcdff33b1f02   # MERGED_SUBSET #226
rmbr 'feat/p11-08-degraded' dfd0eb24a4a557f5801f7a184f9564a032b4bd8b   # MERGED_SUBSET #226
rmbr 'feat/p11-09-reconcile' 48cd8167fb8c549143a0c8deab5c3811904ef87d   # MERGED_SUBSET #226
rmbr 'feat/p11-10-transfer' 91fdf8203ca8497143c0d854488e0ae0a5ad7e7b   # MERGED_SUBSET #226
rmbr 'feat/p11-11-callerid' 64c75788d4ede8a784c7b3bc5f0928d305161b63   # MERGED_SUBSET #226
rmbr 'feat/p11-12-caps' c71b6861ae1ab8b11c29a821d16f43ca419429da   # MERGED_SUBSET #226
rmbr 'feat/p11-13-metering' 47e744bbc09a087c198a37932c4b489a0ed148bd   # MERGED_SUBSET #226
rmbr 'feat/p11-14-norecording' d67a12d7d64f6c5ab2a8419943be016309e2306f   # MERGED_SUBSET #226
rmbr 'feat/p11-15-drain' 9f9eaf071e7381f327ee476fae3465b890a0afc0   # MERGED_SUBSET #226
rmbr 'feat/p11-16-simulator' 90748900acf43a8ec75e12db1cf2341d2ffd0f1d   # MERGED_SUBSET #226
rmbr 'feat/p11-18-absence' b640847764b9d9ee9902d864475b4b14181a6070   # MERGED_SUBSET #226
rmbr 'feat/p12-01-greeting' ee16def610dcb4ac9a67f88374a225f9a488bf72   # MERGED_SUBSET #226
rmbr 'feat/p12-02-intent' b876a280a429c6abd3034e524c2aebfbad320ea3   # MERGED_SUBSET #226
rmbr 'feat/p12-03-faqanswer' 3da7eec069282fb71082b6d4248b662189761fb2   # MERGED_SUBSET #226
rmbr 'feat/p12-04-callback' ec1bfff5e79cca1dca5dcc7f4f24641f3d9023d6   # MERGED_SUBSET #226
rmbr 'feat/p12-05-lead' 3caa70556c53277370aa8db22d396df6afa3bdfe   # MERGED_SUBSET #226
rmbr 'feat/p12-06-appointment' 8c5888b6a158a12fc8850a83304505ca80036c48   # MERGED_SUBSET #226
rmbr 'feat/p12-07-escalation' 30deecc7a01182164954a961e72ff1c3a92a866a   # MERGED_SUBSET #226
rmbr 'feat/p12-08-silence' 5112c10c28c737c5d076515249228d24f7d5e62a   # MERGED_SUBSET #226
rmbr 'feat/p12-09-outcome' 2037b916961f96511d7163fac51de7b0c224016a   # MERGED_SUBSET #226
rmbr 'feat/p12-10-summary' 024a9b6fb79d58afc383518da9982bf5f929f015   # MERGED_SUBSET #226
rmbr 'feat/p13-01-shell' f4a1516723370c18327a5691989e6a7003eeb649   # MERGED_SUBSET #226
rmbr 'feat/p13-02-today' f7b1683eb4f713777785cc48dc6ca621542395c9   # MERGED_SUBSET #226
rmbr 'feat/p13-03-cards' 522c750983281a2500ffaf3b03ccd1a483cd6101   # MERGED_SUBSET #226
rmbr 'feat/p13-04-inbox' a4eeb28ddbc1321d36380def7f06e83d211ca45d   # MERGED_SUBSET #226
rmbr 'feat/p13-05-customers' 05cb281c3832b7692c2a2cd390561aea17c057a5   # MERGED_SUBSET #226
rmbr 'feat/p13-06-knowledge' 2d2f961716b0e1385f69f2aa02895ca301bad7ab   # MERGED_SUBSET #226
rmbr 'feat/p13-08-settings' 7c604f621ac8eb4393e4e9e8456add1e9f5dfb0d   # MERGED_SUBSET #226
rmbr 'feat/p13-09-morning' 0f1a9afb7681a209c063916aef58b721895f15e9   # MERGED_SUBSET #226
rmbr 'feat/p13-10-realtime' 48f679d9d1ecadb4652968b6a34e8fcab3b3f01f   # MERGED_SUBSET #226
rmbr 'feat/p13-11-states' f35c7b1337fa4f14297c167245e116d99eb65cb0   # MERGED_SUBSET #226
rmbr 'feat/p13-12-a11y' 7ffa60f620198aab89a8ba0a3dc1a0793af147bb   # MERGED_SUBSET #226
rmbr 'feat/p13-13-sec' 378796f31f766babb80dbc34af26d2050372e047   # MERGED_SUBSET #226
rmbr 'feat/p14-01-model' aef24333c9ad54527b8456bdda26dccf78f025db   # MERGED_SUBSET #226
rmbr 'feat/p14-05-escalation' b4410fd66a52b2bee1a3468ecf8144c35800e6bf   # MERGED_SUBSET #226
rmbr 'feat/p14-07-delivery' abe46289065e2f97125dba58ab8318789c2be670   # MERGED_SUBSET #226
rmbr 'feat/p14-08-canary' 9ae21ffc7697fdd533536fc999ce54e47d7228f6   # MERGED_SUBSET #226
rmbr 'feat/p15-01-telemetry' bba39c73b7f610f39a957325841bb2878ab4101d   # MERGED_SUBSET #226
rmbr 'feat/p15-02-metrics' ffd255a3821873917b5b60bd17097069ad7876fe   # MERGED_SUBSET #226
rmbr 'feat/p15-04-alarms' 3000742b3a3790b9894936408007559550a884d9   # MERGED_SUBSET #226
rmbr 'feat/p15-05-callcanary' fd162cba748dff9fddd34755063d07e6bb48a347   # MERGED_SUBSET #226
rmbr 'feat/p15-06-debugtime' ccc7ba65404c291316ac390488f6f8584050f648   # MERGED_SUBSET #226
rmbr 'feat/p15-07-opscli' 8bef34f83feef97477a3e55014386a5b51b37601   # MERGED_SUBSET #226
rmbr 'feat/p15-09-runbooks' c58a7ea04adce568b483684db353b7ba5bbd51db   # MERGED_SUBSET #226
rmbr 'feat/p15-10-incident' 35f8980ac44d06f837a37b3660b8909adab8622f   # MERGED_SUBSET #226
rmbr 'feat/p15-11-kpi' d962184454577f9742892b4387be6a2bbaf6f9a3   # MERGED_SUBSET #226
rmbr 'feat/p15-12-costattr' a423fe252b53dd6e3c24a8f15bc2bcb1de74b3d1   # MERGED_SUBSET #226
rmbr 'feat/p16-01-retention' dd2e571bedc89de63bb89ee2e42bf90892160d3c   # MERGED_SUBSET #226
rmbr 'feat/p16-02-tenret' 466d535b684c63123eec07614fe0530498a61e7b   # MERGED_SUBSET #226
rmbr 'feat/p16-03-export' f91d33198e8c9200fe228ccb7852f817cf52292e   # MERGED_SUBSET #226
rmbr 'feat/p16-04-rectify' 26019d24f794c765124ee0d53baf21c23ff269c0   # MERGED_SUBSET #226
rmbr 'feat/p16-05-erasure' d43a0ef3810149e4b5ea8051299b8037199f3ecf   # MERGED_SUBSET #226
rmbr 'feat/p16-06-terminate' 7367b763318c2d4d24a0995e9042b30268e896f9   # MERGED_SUBSET #215
rmbr 'feat/p16-07-ledger' ec94e3d70f7bcdbdb537b36f07d4cd2a1815ee93   # MERGED_SUBSET #226
rmbr 'feat/p16-08-subproc' effed3379f37cec97b40873b5a07024c2634dbeb   # MERGED_SUBSET #226
rmbr 'feat/p16-12-disclosure' 6a0dc1a3d56c7e4c1bc7d7c4dcd381a1c349cea3   # MERGED_SUBSET #226
rmbr 'feat/p16-13-scope' 4d0753aa8a0fd6b3df82f0e7ac75b339099be066   # MERGED_SUBSET #226
rmbr 'feat/p16-17-turnlog' 60c87173f3c7e9764262d1f6858742e51422d671   # MERGED_SUBSET #226
rmbr 'feat/p17-01-prodacct' 82dfdd4fe957306fee17ffcc06c7c37530e45a4d   # MERGED_SUBSET #226
rmbr 'feat/p17-02-hardening' d98315e3b2d3446a75d8163c6330fbc55e4e0867   # MERGED_SUBSET #226
rmbr 'feat/p17-03-waf' 8894b4d08ede240a823ed28eb92aa108244da73f   # MERGED_SUBSET #226
rmbr 'feat/p17-04-secrets' 8727acd5c60c72d8db17b889170b70d3864d0c29   # MERGED_SUBSET #226
rmbr 'feat/p17-05-backup' faad74f4a785301363263c2418b6f6bc49bef88d   # MERGED_SUBSET #226
rmbr 'feat/p17-06-drill' 32ddaa1c3979feaeb32813c731681784bf61e113   # MERGED_SUBSET #226
rmbr 'feat/p17-07-scanbase' 5046e539ffe767c93b66bef7f7c1b83179ea30a8   # MERGED_SUBSET #226
rmbr 'feat/p17-08-access' 131024bbf4e2bef6a3be4f93f2132e90b29c74ab   # MERGED_SUBSET #226
rmbr 'feat/p17-11-drplan' 4ce7ba406991d9cb3dc58aef15886c158e354a86   # MERGED_SUBSET #226
rmbr 'feat/p17-12-readiness' d521d9c08304616b95b477a938f94234bdc98857   # MERGED_SUBSET #226
rmbr 'feat/p18-03-provision' 60fdc662b5c425bcf7a87859e263731d508cbd23   # MERGED_SUBSET #226
rmbr 'feat/p18-09-killswitch' 92247e6c1611819071a85837dd18902c8bab0e87   # MERGED_SUBSET #226
rmbr 'feat/p18-10-monitoring' 0e177a9f25a6fd5aae49ec6ff6b13ff02e5af88b   # MERGED_SUBSET #226
rmbr 'feat/p18-12-gate' 767d008e2bdaa827af92dc53586450a4feafd540   # MERGED_SUBSET #226
rmbr 'feat/p20-booking' 98775d5c614cf901f90044f354b6e773a805c49d   # MERGED_SUBSET #226
rmbr 'feat/p21-handwerk' 1cd331ac39823d88712e9560065f7860973b59e8   # MERGED_SUBSET #226
rmbr 'feat/p22-team' 990d561dd7193b2495a9e3590cfd0e2705090f10   # MERGED_SUBSET #226
rmbr 'feat/p27-email' 38e5c5be295f68f6ed8df295e7a49c34fef02518   # MERGED_SUBSET #226
rmbr 'feat/p28-timeline' 11a18b32664e82b7cce77ab4572babf16c6b206a   # MERGED_SUBSET #226
rmbr 'feat/p29-webhooks' 7a44f5956c9b5beac2bf946c5347ed868daaff22   # MERGED_SUBSET #226
rmbr 'feat/p30-hardening' c58e4b950fad2999b1f13f7018a0c1786a13add3   # MERGED_SUBSET #226
rmbr 'feat/p31-reliability' c4454c4e8fe8ecc09b05e143dd228ab64f961a74   # MERGED_SUBSET #226
rmbr 'feat/p32-validation' 9e02dbc548939373b3aa6eee8556f3d70b8fa3e5   # MERGED_SUBSET #226
rmbr 'feat/p33-sellgate' 4a5818c6da100dec687fd9f97d5e9d4f111db461   # MERGED_SUBSET #226
rmbr 'fix/control-plane-worktree-awareness' 9bace0486968c19e70f5fd8fd11e9b1903e02178   # MERGED_EXACT #30
rmbr 'fix/p02-06-secret-rule' 4b888fe3caece324bd78bb4189e37aecbc0af64b   # MERGED_EXACT #25
rmbr 'fix/p05-01-merge-main' 6a43153800c969445d12ddc39383a44560c6ee9a   # MERGED_EXACT #177
rmbr 'fix/p05-03-merge-main' 4878486534de2a8658faf2657063d0d6261c3cef   # MERGED_EXACT #207
rmbr 'fix/p05-07-merge-main' bd7efd36c47d42ab6a51d35be9550b12f2bb3c04   # MERGED_EXACT #208
rmbr 'fix/p05-09-merge-main' 92d134cd8b611ed1c5aae86df9de8c61cbc165ed   # MERGED_EXACT #209
rmbr 'fix/p08-01-envelope-merge-main' bb0bcd450d4f8a860cdf742008c813b9addaf5a8   # MERGED_EXACT #107
rmbr 'fix/p08-02-merge-main' f1763004918367a8d649cd2303c16833498ede02   # MERGED_EXACT #108
rmbr 'fix/p08-03-merge-main' cd72007ac35b1b190aa3a074d2acab602957d13a   # MERGED_EXACT #109
rmbr 'fix/p08-04-merge-main' e1b7c6670fd17253a23148294a598d110348f551   # MERGED_EXACT #110
rmbr 'fix/p08-05-merge-main' 5b2efc11b10ef5f89572c9727c0b74ccea12ff34   # MERGED_EXACT #111
rmbr 'fix/p08-06-merge-main' 056ac5b6364bd69f461b39a6b5e8fcc8cae92e1a   # MERGED_EXACT #112
rmbr 'fix/p08-07-merge-main' 5ad6a7691da47a0867fde6723a5c8af9fb89ee88   # MERGED_EXACT #113
rmbr 'fix/p08-08-merge-main' 26f8c1e5a9d5cab84206742e16491a5652acdfe0   # MERGED_EXACT #114
rmbr 'fix/p08-09-merge-main' 43043e5949e2cf2ff72c3182d3c58758277088a0   # MERGED_EXACT #115
rmbr 'fix/p08-10-merge-main' d0feb3e43dfa6d9abe49dc80c7e4e33ac11ead3f   # MERGED_EXACT #116
rmbr 'fix/p08-11-merge-main' f63b8758c49ec5fb74900d3131b24bce13c13d14   # MERGED_EXACT #117
rmbr 'fix/p09-0803-merge-main' b66d1b9a57e2ba9062c1e68af337ec617d400db5   # MERGED_EXACT #210
rmbr 'fix/p09-0904-merge-main' c30429c5382c6a294e1195f89e3e1948aa86d992   # MERGED_EXACT #216
rmbr 'fix/p10-01-merge-main' f31ad7616a217c934d201e78d6f9a41fdba6e6e4   # MERGED_EXACT #118
rmbr 'fix/p10-02-merge-main' e752c994418f5ceaca6b1d6004ac4c7a25e19834   # MERGED_EXACT #211
rmbr 'fix/p10-03-merge-main' 6300d819c1f525d652b388521d91cd19dcef766d   # MERGED_EXACT #119
rmbr 'fix/p10-04-merge-main' 3d37358993d8fc52890a02fe2c09be0aea071915   # MERGED_EXACT #120
rmbr 'fix/p10-05-merge-main' 952c2e7a50a3f22e80778f4cdf8b3971f9dfb2aa   # MERGED_EXACT #121
rmbr 'fix/p10-06-merge-main' 6f8b41c045df71652922b500c5bd970e5da41057   # MERGED_EXACT #122
rmbr 'fix/p10-07-merge-main' 1726a583bef0afc26c84f191db976a1beaa2857e   # MERGED_EXACT #123
rmbr 'fix/p10-08-merge-main' 316767745c6218b1ad8b844195b6c6077ec09f63   # MERGED_EXACT #124
rmbr 'fix/p10-09-merge-main' 3ef07fb2e7e2dfff0f6722a6a682db4b9449b023   # MERGED_EXACT #125
rmbr 'fix/p10-10-merge-main' 226ae469373fc5835ad647dc5bddeb3d0f9a0162   # MERGED_EXACT #126
rmbr 'fix/p10-11-merge-main' aad86632dc1b290f5b3a5d7e77e760ac47330d52   # MERGED_EXACT #127
rmbr 'fix/p10-12-merge-main' a91fe9b6ad19dc8aadfeafb43d3a369ff5ad5a60   # MERGED_EXACT #128
rmbr 'fix/p10-13-merge-main' 7141e9b9848c33e9e940224176464d5a480efeca   # MERGED_EXACT #129
rmbr 'fix/p10-14-merge-main' 93debf71f99488ec092a7f5a45aaa0aa8b06ccea   # MERGED_EXACT #130
rmbr 'fix/p10-15-merge-main' 1a7bc891dbfe212d3b4f3c9399097f2469d4533e   # MERGED_EXACT #212
rmbr 'fix/p11-01-merge-main' fc8d50b4f238dfce88cec2c051faa8d8701c86f0   # MERGED_EXACT #131
rmbr 'fix/p11-02-merge-main' 624fcbf05a338a9ed82eb2aca63df17e93baedb4   # MERGED_EXACT #132
rmbr 'fix/p11-03-merge-main' d66411bdf904ce48df758bc33bc316d4e16ee9fc   # MERGED_EXACT #133
rmbr 'fix/p11-04-merge-main' cfa7df762e485b57c31291ce27346189511ca3ed   # MERGED_EXACT #134
rmbr 'fix/p11-05-merge-main' aaa3e8ce8965b6486071ad991b8e287fa500d81f   # MERGED_EXACT #135
rmbr 'fix/p11-06-merge-main' 98c599f282234665893f0246e1d62b0270585fef   # MERGED_EXACT #136
rmbr 'fix/p11-07-merge-main' 12f2769a30f26c4410053a2bba178ac13a079ef6   # MERGED_EXACT #137
rmbr 'fix/p11-08-merge-main' 9d30ccd3aff26bc5b1ab02a22cf24663a66ed2fd   # MERGED_EXACT #138
rmbr 'fix/p11-09-merge-main' 26817be90373fa5ae031893c7e6ca22d4991fdfd   # MERGED_EXACT #139
rmbr 'fix/p11-10-merge-main' 317c0438f48bbca3135c60451db9d76909ea5f50   # MERGED_EXACT #213
rmbr 'fix/p11-11-merge-main' f444397752380cb077db00117a4effe85a35e361   # MERGED_EXACT #140
rmbr 'fix/p11-12-merge-main' 732e44df0134b18d2e6db8f5687eb1a88f934ca6   # MERGED_EXACT #141
rmbr 'fix/p11-13-merge-main' 50930c625bde1d3791d04f588163bb64593c849b   # MERGED_EXACT #142
rmbr 'fix/p11-14-merge-main' 7e42bc8f9b40717f5bc3d27c62e3f6509bf83dd4   # MERGED_EXACT #143
rmbr 'fix/p11-15-merge-main' c76b2681d34c1e24506e1c2a2f455e74ac89ebef   # MERGED_EXACT #144
rmbr 'fix/p11-16-merge-main' 84d00dbb741cb75135d607474e55710431989a14   # MERGED_EXACT #145
rmbr 'fix/p11-18-merge-main' b0172b08665ff5b3965aa2d233a57ebc2fdd60b0   # MERGED_EXACT #146
rmbr 'fix/p12-01-merge-main' 601bcb1bc6b3e982dc08a58b9efb5e3138372fb4   # MERGED_EXACT #147
rmbr 'fix/p12-02-merge-main' 513750e2fdd44ddf5ca97c393cf067cdb9d5f2d0   # MERGED_EXACT #148
rmbr 'fix/p12-03-merge-main' bb78ce10a97b9f9cafae6620a666f12ba0a9f8a2   # MERGED_EXACT #149
rmbr 'fix/p12-04-merge-main' a986d58929b8ede9dad318d048582a9c82820cba   # MERGED_EXACT #150
rmbr 'fix/p12-05-merge-main' f1baf9ba44cfbd4afe770849ad273f55faf5ec9b   # MERGED_EXACT #151
rmbr 'fix/p12-06-merge-main' f5084e6336e3467c36f0880f8150fc808a82a3a9   # MERGED_EXACT #152
rmbr 'fix/p12-07-merge-main' f2da0fcd15943a7dbbe6595ea761dc752f8cdbae   # MERGED_EXACT #153
rmbr 'fix/p12-08-merge-main' 1f8fb5f72fd5b5d4803042c21047bf03972747ff   # MERGED_EXACT #154
rmbr 'fix/p12-09-merge-main' 25c4cdd138b0d4eec7c002c7ac993fa17fa4c0e0   # MERGED_EXACT #155
rmbr 'fix/p12-10-merge-main' 95f58694ccb91ed2539fcd1c508898cf77efc2e0   # MERGED_EXACT #156
rmbr 'fix/p13-01-merge-main' 0f3c2bbc2d89e76cdb245310baceb13cebdf7b39   # MERGED_EXACT #157
rmbr 'fix/p13-02-merge-main' b0e44a9584b5d63147017ba32e9d9726380bbd6c   # MERGED_EXACT #158
rmbr 'fix/p13-03-merge-main' 50ddc8cedd426ef161e60e3521d1569158b99642   # MERGED_EXACT #159
rmbr 'fix/p13-04-merge-main' 6ab646457a043c7ad0efc9d88f7263d4b512d26f   # MERGED_EXACT #160
rmbr 'fix/p13-05-merge-main' a650bfd9be9f63b0767ef0e28e2111a2b46de9ae   # MERGED_EXACT #161
rmbr 'fix/p13-06-merge-main' 6684f6db78250841d0baaadd341b6b3858266b1b   # MERGED_EXACT #162
rmbr 'fix/p13-08-merge-main' 47015d1a04dad7f1feed5dbef7a3b49a24ab5def   # MERGED_EXACT #163
rmbr 'fix/p13-09-merge-main' dfa0d6138161b01fdb94f07c16e0056b5f669c48   # MERGED_EXACT #164
rmbr 'fix/p13-10-merge-main' 994e00144bf48f42afa3b7eccbad8f4d69df6b10   # MERGED_EXACT #165
rmbr 'fix/p13-11-merge-main' d4b8c89707ae996483a62fc95dbf5c980495bdcf   # MERGED_SUBSET #166
rmbr 'fix/p13-11-merge-main-2' e4f5f9363c4e396749665b5b098e147a4e9b998e   # MERGED_EXACT #166
rmbr 'fix/p13-12-merge-main' d7a307dca351f1308293364133591ac522e6f523   # MERGED_EXACT #167
rmbr 'fix/p13-13-merge-main' 18c04d43718767ce08c0e122ce3987ae1da3476f   # MERGED_EXACT #168
rmbr 'fix/p14-01-merge-main' 663178924f10f884d4fdb7f7113da4dbe9ff817a   # MERGED_EXACT #169
rmbr 'fix/p14-05-merge-main' bd297cea8b3145e9a8eb0de2463a70bba1bbcc74   # MERGED_EXACT #170
rmbr 'fix/p14-07-merge-main' 5111a80e23fd759b767cbacf2262006aadd5f2b5   # MERGED_EXACT #171
rmbr 'fix/p14-08-merge-main' 13edb1dc38e46ce41d8ee6fbbac399ec0134b2d0   # MERGED_EXACT #172
rmbr 'fix/p15-01-merge-main' 96f1e8355dba2eb93791d829aa30b1f148c8511e   # MERGED_EXACT #173
rmbr 'fix/p15-02-merge-main' f4d32ac93f9b14c1e2ded8eb9c56325124a531cd   # MERGED_EXACT #174
rmbr 'fix/p15-04-merge-main' 5b99993fa8571614bfb22bd0813a4f94ef14ffb5   # MERGED_EXACT #175
rmbr 'fix/p15-05-merge-main' 79f8617ac0cba014833eb7db96b63ec691799424   # MERGED_EXACT #176
rmbr 'fix/p15-06-merge-main' 8b3fa1eafa52e79b58bb78b7757cc196f841e8bc   # MERGED_EXACT #178
rmbr 'fix/p15-07-merge-main' 1b7558dd026ad32c61f24d58dc4237b1a0b9e121   # MERGED_EXACT #179
rmbr 'fix/p15-09-merge-main' 80bfda248aa64656aacd059eadb77c33bbaac68b   # MERGED_EXACT #180
rmbr 'fix/p15-10-merge-main' ad6f234fd908be0d19a068402692199850d9b02e   # MERGED_EXACT #181
rmbr 'fix/p15-11-merge-main' 1cafd5c29cfec02d93c8038cc01ce3466e47873c   # MERGED_EXACT #182
rmbr 'fix/p15-12-merge-main' 8e0e7d99e088ecd2af0208b563111b5a477e0849   # MERGED_EXACT #183
rmbr 'fix/p16-01-merge-main' 43f679209f013c8796b61a44117467d46e57147d   # MERGED_EXACT #184
rmbr 'fix/p16-02-merge-main' 9fff71413b61c1b65dac3c219efae462e03fac62   # MERGED_EXACT #185
rmbr 'fix/p16-03-merge-main' 22d512aa94220f3cf744a5381171a77408e3f73b   # MERGED_EXACT #214
rmbr 'fix/p16-04-merge-main' d4a69bc9febb28d12f4220db6deb66e9b17bedf8   # MERGED_EXACT #186
rmbr 'fix/p16-05-merge-main' 218b17d2e3e519403beaf27b36ff6691cfaee915   # MERGED_EXACT #187
rmbr 'fix/p16-06-merge-main' 99b2dcfaa819c800d025e614ecda5d2df413f672   # MERGED_EXACT #215
rmbr 'fix/p16-07-merge-main' 4bb36c1a986c45974027d028ee57d4f7b1b2f1a5   # MERGED_EXACT #188
rmbr 'fix/p16-08-merge-main' 27358be69ab06ad4f82d5758eb26e07e4b424d4a   # MERGED_EXACT #189
rmbr 'fix/p16-12-merge-main' 70ddcb4b269a4adc9b243a2d1122c5e7861222f1   # MERGED_EXACT #190
rmbr 'fix/p16-13-merge-main' 21c9c842eacf5601981e9fbacb2b7fe72c1aabdc   # MERGED_EXACT #191
rmbr 'fix/p16-17-merge-main' aed2f2143df5dcb8a4c2e2f8062c4167a9c2ffd6   # MERGED_EXACT #192
rmbr 'fix/p17-01-merge-main' 961e07e7118dd464c7fa44647b5e1a45dd86a38e   # MERGED_EXACT #193
rmbr 'fix/p17-02-merge-main' 1c3a6d96bf255202a8e9966332a5cc24073fe4a9   # MERGED_EXACT #194
rmbr 'fix/p17-03-merge-main' 8e6882b44906fc3f859a023e99a417763dd11192   # MERGED_EXACT #195
rmbr 'fix/p17-04-merge-main' 8b724567742d08154f34f091194c2c72346a8350   # MERGED_EXACT #196
rmbr 'fix/p17-05-merge-main' ce189af5cd93d0ed8877b125427adc4f70ede508   # MERGED_EXACT #197
rmbr 'fix/p17-06-merge-main' f0289d25c84963f38243d095ded16b9aa1f553b3   # MERGED_EXACT #198
rmbr 'fix/p17-07-merge-main' d6df3e2ef47a86ba5a30384e2e5b7c06cde8ed8f   # MERGED_EXACT #199
rmbr 'fix/p17-08-merge-main' 71b8ded1012b9ffab32f4cd67786bb1ee9c0bb6b   # MERGED_EXACT #200
rmbr 'fix/p17-11-merge-main' 26be941ddfc07db370299d17d1b47cc3d3aa61e0   # MERGED_EXACT #201
rmbr 'fix/p17-12-merge-main' 9632185316359ea10a27171111217d24a8c74e1e   # MERGED_EXACT #202
rmbr 'fix/p18-03-merge-main' 66510e1ee096d2c153d68b86ef3f21d3f9ef9e94   # MERGED_EXACT #203
rmbr 'fix/p18-09-merge-main' a045c7aa7bd7549dc8c72c6105d34d272daa5e31   # MERGED_EXACT #204
rmbr 'fix/p18-10-merge-main' 204a6668e8f03243f171dd4121a02c5c13ff8ab1   # MERGED_EXACT #205
rmbr 'fix/p18-12-merge-main' 0d53f428c6410ec7366607698c3743baf9ed7d41   # MERGED_EXACT #206
rmbr 'fix/p20-merge-main' 16c20b61670525b79a5d2ff5b67f914aed5b9b74   # MERGED_EXACT #217
rmbr 'fix/p21-merge-main' 0490a2e7b0af14c5ccecdc8714c54faa6355cfd2   # MERGED_EXACT #218
rmbr 'fix/p22-merge-main' 14326e2d0a1c9bd6c03e2070723b781f88346076   # MERGED_EXACT #219
rmbr 'fix/p27-merge-main' 66b30e942943ce89e69031a0760c795f0acf8283   # MERGED_EXACT #220
rmbr 'fix/p28-merge-main' 5ebff46ae350f9cfa5ec6ba3685ce2daa7e76d50   # MERGED_EXACT #221
rmbr 'fix/p29-merge-main' 2e3095189aac679c40e75427b3bca6c67d64e6a5   # MERGED_EXACT #222
rmbr 'fix/p30-merge-main' e6aa1c58a90f419664c958c261a144116043be0a   # MERGED_EXACT #223
rmbr 'fix/p31-merge-main' 6f97d81b55f8c2b0924fcc5e9862cda980aae214   # MERGED_EXACT #224
rmbr 'fix/p32-merge-main' d8b1974f8d2eb064171f610e671db11a80490abd   # MERGED_EXACT #225
rmbr 'fix/p33-merge-main' 865b4c177aeb85bfe5329a62e068981dc90ec052   # MERGED_EXACT #226
rmbr 'fix/qg09-s2-lock-order' 934691cc0297b37a1a7f86d48c933bf28a1ee46c   # MERGED_PLUS_1 #70
rmbr 'fix/qg09-s4-lifecycle' 6614676ca534f9db7cc5195c0df05c4def20d400   # MERGED_EXACT #72
rmbr 'fix/qg09-s5-rbac' 25daa51dab21a826b23bbf025b568e1f0309e630   # MERGED_EXACT #73
rmbr 'fix/qg09-s6-invitations' 0c7f6e9b53a7205f2eae45175142254bd3644e19   # MERGED_EXACT #74
rmbr 'fix/qg09-s7-recovery' 56da05ec4bcfa931683cde9aefc2812b4bfcb554   # MERGED_EXACT #77
rmbr 'fix/qg09-s9-grants' 5037d380bb1ceaf91f48c8dfae46c79b3648d459   # MERGED_EXACT #71
rmbr 'test/p02-05-harness' e7bddc75dd2c38ee5a0d7f1643a93cc5ab1f23e0   # IN_MAIN 
rmbr 'test/p06-03-tenant-from-session' 2c95bbaea06a753c36d26b675c549aa402f89c02   # MERGED_EXACT #49
rmbr 'tmp/prepared-p06-10-audit' d72c9d72cf460692d66f8d1cb719c8e8d0326e6b   # MERGED_SUBSET #31

# STEP 8 — FOUNDER ONLY: remote branches (216 non-main, all merged). Two carry one docs-only commit
#          that never reached main (listed last); delete those only if you accept losing it.
#          Afterwards enable Settings → General → "Automatically delete head branches".
git -C "$REPO" push origin --delete 'chore/p00-02-evidence-bookkeeping'   # IN_MAIN 
git -C "$REPO" push origin --delete 'chore/p02-01-governance'   # MERGED_PLUS_2 #3
git -C "$REPO" push origin --delete 'chore/p02-02-qg01-gates'   # IN_MAIN 
git -C "$REPO" push origin --delete 'chore/p02-02-toolchain'   # MERGED_PLUS_3 #4
git -C "$REPO" push origin --delete 'chore/p02-04-local-stack'   # MERGED_PLUS_3 #6
git -C "$REPO" push origin --delete 'chore/p02-06-ci'   # MERGED_PLUS_6 #8
git -C "$REPO" push origin --delete 'chore/p04-11-stack-integration'   # IN_MAIN 
git -C "$REPO" push origin --delete 'chore/p04-qg-gates-final'   # IN_MAIN 
git -C "$REPO" push origin --delete 'chore/p06-13-05-tick'   # MERGED_EXACT #51
git -C "$REPO" push origin --delete 'chore/p06-13-ci-wiring'   # MERGED_EXACT #50
git -C "$REPO" push origin --delete 'docs/legal-licence'   # MERGED_EXACT #59
git -C "$REPO" push origin --delete 'docs/p02-01-ruleset-evidence'   # MERGED_EXACT #26
git -C "$REPO" push origin --delete 'docs/p02-07-developer-docs'   # MERGED_PLUS_3 #9
git -C "$REPO" push origin --delete 'docs/p03-01-adrs'   # MERGED_PLUS_3 #10
git -C "$REPO" push origin --delete 'docs/p03-02-domain-model'   # MERGED_PLUS_2 #11
git -C "$REPO" push origin --delete 'docs/p03-04-diagrams'   # MERGED_PLUS_5 #13
git -C "$REPO" push origin --delete 'docs/p03-05-threat-model'   # MERGED_PLUS_2 #14
git -C "$REPO" push origin --delete 'docs/p03-06-data-inventory'   # MERGED_PLUS_2 #12
git -C "$REPO" push origin --delete 'docs/p05-01-aws-org-baseline'   # MERGED_EXACT #177
git -C "$REPO" push origin --delete 'docs/p06-03-04-annotation'   # MERGED_EXACT #58
git -C "$REPO" push origin --delete 'docs/p06-07-05-tick'   # MERGED_EXACT #53
git -C "$REPO" push origin --delete 'docs/p06-08-03-tick'   # MERGED_EXACT #55
git -C "$REPO" push origin --delete 'docs/p06-12-01-cognito-lockout'   # MERGED_EXACT #56
git -C "$REPO" push origin --delete 'docs/qg-09-plan'   # MERGED_EXACT #60
git -C "$REPO" push origin --delete 'docs/qg-09-s1-3-evidence'   # MERGED_EXACT #61
git -C "$REPO" push origin --delete 'docs/qg-09-s10-throttles'   # MERGED_EXACT #66
git -C "$REPO" push origin --delete 'docs/qg-09-s11-xsuite'   # MERGED_EXACT #67
git -C "$REPO" push origin --delete 'docs/qg-09-s12-tenant'   # MERGED_EXACT #68
git -C "$REPO" push origin --delete 'docs/qg-09-s13-resolver'   # MERGED_EXACT #69
git -C "$REPO" push origin --delete 'docs/qg-09-s4-7-evidence'   # MERGED_EXACT #62
git -C "$REPO" push origin --delete 'docs/qg-09-s8-13-evidence'   # MERGED_EXACT #63
git -C "$REPO" push origin --delete 'docs/qg-09-s8-13-reviews'   # MERGED_EXACT #64
git -C "$REPO" push origin --delete 'docs/qg-09-s9-grants'   # MERGED_EXACT #65
git -C "$REPO" push origin --delete 'docs/qg09-founder-verdicts'   # MERGED_EXACT #76
git -C "$REPO" push origin --delete 'docs/qg09-s7-closure'   # MERGED_EXACT #78
git -C "$REPO" push origin --delete 'feat/p02-03-skeleton'   # MERGED_PLUS_6 #5
git -C "$REPO" push origin --delete 'feat/p04-04-voice-adapter'   # IN_MAIN 
git -C "$REPO" push origin --delete 'feat/p05-03-terraform'   # MERGED_EXACT #207
git -C "$REPO" push origin --delete 'feat/p05-07-datasvc'   # MERGED_EXACT #208
git -C "$REPO" push origin --delete 'feat/p05-09-pipeline'   # MERGED_EXACT #209
git -C "$REPO" push origin --delete 'feat/p06-01-06-identity'   # MERGED_EXACT #79
git -C "$REPO" push origin --delete 'feat/p06-01-roles-and-rls'   # MERGED_EXACT #27
git -C "$REPO" push origin --delete 'feat/p06-03-04-resolve-route'   # MERGED_EXACT #57
git -C "$REPO" push origin --delete 'feat/p06-03-tenant-context'   # MERGED_EXACT #28
git -C "$REPO" push origin --delete 'feat/p06-04-provisioning'   # MERGED_EXACT #29
git -C "$REPO" push origin --delete 'feat/p06-05-04-claims-switch'   # MERGED_EXACT #33
git -C "$REPO" push origin --delete 'feat/p06-05-local-oidc'   # MERGED_EXACT #32
git -C "$REPO" push origin --delete 'feat/p06-06-csrf'   # MERGED_EXACT #40
git -C "$REPO" push origin --delete 'feat/p06-06-lifecycle'   # MERGED_EXACT #41
git -C "$REPO" push origin --delete 'feat/p06-06-membership-recheck'   # MERGED_EXACT #36
git -C "$REPO" push origin --delete 'feat/p06-06-revocation'   # MERGED_EXACT #39
git -C "$REPO" push origin --delete 'feat/p06-06-session-foundation'   # MERGED_EXACT #35
git -C "$REPO" push origin --delete 'feat/p06-06-step-up-mfa'   # MERGED_EXACT #38
git -C "$REPO" push origin --delete 'feat/p06-07-05-real-matrix'   # MERGED_EXACT #52
git -C "$REPO" push origin --delete 'feat/p06-07-rbac'   # MERGED_EXACT #42
git -C "$REPO" push origin --delete 'feat/p06-08-03-unassign'   # MERGED_EXACT #54
git -C "$REPO" push origin --delete 'feat/p06-08-invitations'   # MERGED_EXACT #43
git -C "$REPO" push origin --delete 'feat/p06-09-03-recovery-runbooks'   # MERGED_EXACT #34
git -C "$REPO" push origin --delete 'feat/p06-09-recovery'   # MERGED_EXACT #44
git -C "$REPO" push origin --delete 'feat/p06-10-03-adoption'   # MERGED_EXACT #45
git -C "$REPO" push origin --delete 'feat/p06-10-audit'   # MERGED_EXACT #31
git -C "$REPO" push origin --delete 'feat/p06-11-support'   # MERGED_EXACT #46
git -C "$REPO" push origin --delete 'feat/p06-12-abuse'   # MERGED_EXACT #47
git -C "$REPO" push origin --delete 'feat/p06-13-xsuite'   # MERGED_EXACT #48
git -C "$REPO" push origin --delete 'feat/p07-01-value-objects'   # MERGED_EXACT #80
git -C "$REPO" push origin --delete 'feat/p07-02-contacts'   # MERGED_EXACT #81
git -C "$REPO" push origin --delete 'feat/p07-03-resolution'   # MERGED_EXACT #82
git -C "$REPO" push origin --delete 'feat/p07-04-merge'   # MERGED_EXACT #92
git -C "$REPO" push origin --delete 'feat/p07-05-conversations'   # MERGED_EXACT #83
git -C "$REPO" push origin --delete 'feat/p07-06-tasks'   # MERGED_EXACT #84
git -C "$REPO" push origin --delete 'feat/p07-07-leads'   # MERGED_EXACT #85
git -C "$REPO" push origin --delete 'feat/p07-08-appointments'   # MERGED_EXACT #86
git -C "$REPO" push origin --delete 'feat/p07-09-notes-facts'   # MERGED_EXACT #87
git -C "$REPO" push origin --delete 'feat/p07-10-governance'   # MERGED_EXACT #88
git -C "$REPO" push origin --delete 'feat/p07-11-finaliser'   # MERGED_EXACT #89
git -C "$REPO" push origin --delete 'feat/p07-12-search'   # MERGED_EXACT #93
git -C "$REPO" push origin --delete 'feat/p07-13-concurrency'   # MERGED_EXACT #90
git -C "$REPO" push origin --delete 'feat/p07-14-time-locale'   # MERGED_EXACT #91
git -C "$REPO" push origin --delete 'feat/p07-gate-closeout'   # MERGED_EXACT #95
git -C "$REPO" push origin --delete 'feat/p08-01-envelope'   # MERGED_EXACT #107
git -C "$REPO" push origin --delete 'feat/p08-02-outbox'   # MERGED_EXACT #108
git -C "$REPO" push origin --delete 'feat/p08-03-inbox'   # MERGED_EXACT #109
git -C "$REPO" push origin --delete 'feat/p08-04-idempotency'   # MERGED_EXACT #110
git -C "$REPO" push origin --delete 'feat/p08-05-worker'   # MERGED_EXACT #111
git -C "$REPO" push origin --delete 'feat/p08-06-history'   # MERGED_EXACT #112
git -C "$REPO" push origin --delete 'feat/p08-07-timers'   # MERGED_EXACT #113
git -C "$REPO" push origin --delete 'feat/p08-08-sse'   # MERGED_EXACT #114
git -C "$REPO" push origin --delete 'feat/p08-09-ratelimit'   # MERGED_EXACT #115
git -C "$REPO" push origin --delete 'feat/p08-10-flags'   # MERGED_EXACT #116
git -C "$REPO" push origin --delete 'feat/p08-11-chaos'   # MERGED_EXACT #117
git -C "$REPO" push origin --delete 'feat/p09-01-model'   # MERGED_EXACT #96
git -C "$REPO" push origin --delete 'feat/p09-02-profile'   # MERGED_EXACT #97
git -C "$REPO" push origin --delete 'feat/p09-03-hours'   # MERGED_EXACT #98
git -C "$REPO" push origin --delete 'feat/p09-04-faq'   # MERGED_EXACT #99
git -C "$REPO" push origin --delete 'feat/p09-05-approval'   # MERGED_EXACT #100
git -C "$REPO" push origin --delete 'feat/p09-06-staleness'   # MERGED_EXACT #101
git -C "$REPO" push origin --delete 'feat/p09-07-conflicts'   # MERGED_EXACT #102
git -C "$REPO" push origin --delete 'feat/p09-08-import'   # MERGED_EXACT #103
git -C "$REPO" push origin --delete 'feat/p09-0803-pdf'   # MERGED_EXACT #210
git -C "$REPO" push origin --delete 'feat/p09-0904-passages'   # MERGED_EXACT #216
git -C "$REPO" push origin --delete 'feat/p09-10-channels'   # MERGED_EXACT #105
git -C "$REPO" push origin --delete 'feat/p09-11-evalset'   # MERGED_EXACT #106
git -C "$REPO" push origin --delete 'feat/p10-01-gateway'   # MERGED_EXACT #118
git -C "$REPO" push origin --delete 'feat/p10-02-altprovider'   # MERGED_EXACT #211
git -C "$REPO" push origin --delete 'feat/p10-03-structured'   # MERGED_EXACT #119
git -C "$REPO" push origin --delete 'feat/p10-04-resilience'   # MERGED_EXACT #120
git -C "$REPO" push origin --delete 'feat/p10-05-redaction'   # MERGED_EXACT #121
git -C "$REPO" push origin --delete 'feat/p10-06-registry'   # MERGED_EXACT #122
git -C "$REPO" push origin --delete 'feat/p10-07-policy'   # MERGED_EXACT #123
git -C "$REPO" push origin --delete 'feat/p10-08-tools'   # MERGED_EXACT #124
git -C "$REPO" push origin --delete 'feat/p10-09-templates'   # MERGED_EXACT #125
git -C "$REPO" push origin --delete 'feat/p10-10-rules'   # MERGED_EXACT #126
git -C "$REPO" push origin --delete 'feat/p10-11-lifesafety'   # MERGED_EXACT #127
git -C "$REPO" push origin --delete 'feat/p10-12-injection'   # MERGED_EXACT #128
git -C "$REPO" push origin --delete 'feat/p10-13-evalharness'   # MERGED_EXACT #129
git -C "$REPO" push origin --delete 'feat/p10-14-telemetry'   # MERGED_EXACT #130
git -C "$REPO" push origin --delete 'feat/p10-15-rollout'   # MERGED_EXACT #212
git -C "$REPO" push origin --delete 'feat/p11-01-routing'   # MERGED_EXACT #131
git -C "$REPO" push origin --delete 'feat/p11-02-webhook'   # MERGED_EXACT #132
git -C "$REPO" push origin --delete 'feat/p11-03-validation'   # MERGED_EXACT #133
git -C "$REPO" push origin --delete 'feat/p11-04-relay'   # MERGED_EXACT #134
git -C "$REPO" push origin --delete 'feat/p11-05-session'   # MERGED_EXACT #135
git -C "$REPO" push origin --delete 'feat/p11-06-callbacks'   # MERGED_EXACT #136
git -C "$REPO" push origin --delete 'feat/p11-07-fallback'   # MERGED_EXACT #137
git -C "$REPO" push origin --delete 'feat/p11-08-degraded'   # MERGED_EXACT #138
git -C "$REPO" push origin --delete 'feat/p11-09-reconcile'   # MERGED_EXACT #139
git -C "$REPO" push origin --delete 'feat/p11-10-transfer'   # MERGED_EXACT #213
git -C "$REPO" push origin --delete 'feat/p11-11-callerid'   # MERGED_EXACT #140
git -C "$REPO" push origin --delete 'feat/p11-12-caps'   # MERGED_EXACT #141
git -C "$REPO" push origin --delete 'feat/p11-13-metering'   # MERGED_EXACT #142
git -C "$REPO" push origin --delete 'feat/p11-14-norecording'   # MERGED_EXACT #143
git -C "$REPO" push origin --delete 'feat/p11-15-drain'   # MERGED_EXACT #144
git -C "$REPO" push origin --delete 'feat/p11-16-simulator'   # MERGED_EXACT #145
git -C "$REPO" push origin --delete 'feat/p11-18-absence'   # MERGED_EXACT #146
git -C "$REPO" push origin --delete 'feat/p12-01-greeting'   # MERGED_EXACT #147
git -C "$REPO" push origin --delete 'feat/p12-02-intent'   # MERGED_EXACT #148
git -C "$REPO" push origin --delete 'feat/p12-03-faqanswer'   # MERGED_EXACT #149
git -C "$REPO" push origin --delete 'feat/p12-04-callback'   # MERGED_EXACT #150
git -C "$REPO" push origin --delete 'feat/p12-05-lead'   # MERGED_EXACT #151
git -C "$REPO" push origin --delete 'feat/p12-06-appointment'   # MERGED_EXACT #152
git -C "$REPO" push origin --delete 'feat/p12-07-escalation'   # MERGED_EXACT #153
git -C "$REPO" push origin --delete 'feat/p12-08-silence'   # MERGED_EXACT #154
git -C "$REPO" push origin --delete 'feat/p12-09-outcome'   # MERGED_EXACT #155
git -C "$REPO" push origin --delete 'feat/p12-10-summary'   # MERGED_EXACT #156
git -C "$REPO" push origin --delete 'feat/p13-01-shell'   # MERGED_EXACT #157
git -C "$REPO" push origin --delete 'feat/p13-02-today'   # MERGED_EXACT #158
git -C "$REPO" push origin --delete 'feat/p13-03-cards'   # MERGED_EXACT #159
git -C "$REPO" push origin --delete 'feat/p13-04-inbox'   # MERGED_EXACT #160
git -C "$REPO" push origin --delete 'feat/p13-05-customers'   # MERGED_EXACT #161
git -C "$REPO" push origin --delete 'feat/p13-06-knowledge'   # MERGED_EXACT #162
git -C "$REPO" push origin --delete 'feat/p13-08-settings'   # MERGED_EXACT #163
git -C "$REPO" push origin --delete 'feat/p13-09-morning'   # MERGED_EXACT #164
git -C "$REPO" push origin --delete 'feat/p13-10-realtime'   # MERGED_EXACT #165
git -C "$REPO" push origin --delete 'feat/p13-11-states'   # MERGED_EXACT #166
git -C "$REPO" push origin --delete 'feat/p13-12-a11y'   # MERGED_EXACT #167
git -C "$REPO" push origin --delete 'feat/p13-13-sec'   # MERGED_EXACT #168
git -C "$REPO" push origin --delete 'feat/p14-01-model'   # MERGED_EXACT #169
git -C "$REPO" push origin --delete 'feat/p14-05-escalation'   # MERGED_EXACT #170
git -C "$REPO" push origin --delete 'feat/p14-07-delivery'   # MERGED_EXACT #171
git -C "$REPO" push origin --delete 'feat/p14-08-canary'   # MERGED_EXACT #172
git -C "$REPO" push origin --delete 'feat/p15-01-telemetry'   # MERGED_EXACT #173
git -C "$REPO" push origin --delete 'feat/p15-02-metrics'   # MERGED_EXACT #174
git -C "$REPO" push origin --delete 'feat/p15-04-alarms'   # MERGED_EXACT #175
git -C "$REPO" push origin --delete 'feat/p15-05-callcanary'   # MERGED_EXACT #176
git -C "$REPO" push origin --delete 'feat/p15-06-debugtime'   # MERGED_EXACT #178
git -C "$REPO" push origin --delete 'feat/p15-07-opscli'   # MERGED_EXACT #179
git -C "$REPO" push origin --delete 'feat/p15-09-runbooks'   # MERGED_EXACT #180
git -C "$REPO" push origin --delete 'feat/p15-10-incident'   # MERGED_EXACT #181
git -C "$REPO" push origin --delete 'feat/p15-11-kpi'   # MERGED_EXACT #182
git -C "$REPO" push origin --delete 'feat/p15-12-costattr'   # MERGED_EXACT #183
git -C "$REPO" push origin --delete 'feat/p16-01-retention'   # MERGED_EXACT #184
git -C "$REPO" push origin --delete 'feat/p16-02-tenret'   # MERGED_EXACT #185
git -C "$REPO" push origin --delete 'feat/p16-03-export'   # MERGED_EXACT #214
git -C "$REPO" push origin --delete 'feat/p16-04-rectify'   # MERGED_EXACT #186
git -C "$REPO" push origin --delete 'feat/p16-05-erasure'   # MERGED_EXACT #187
git -C "$REPO" push origin --delete 'feat/p16-06-terminate'   # MERGED_EXACT #215
git -C "$REPO" push origin --delete 'feat/p16-07-ledger'   # MERGED_EXACT #188
git -C "$REPO" push origin --delete 'feat/p16-08-subproc'   # MERGED_EXACT #189
git -C "$REPO" push origin --delete 'feat/p16-12-disclosure'   # MERGED_EXACT #190
git -C "$REPO" push origin --delete 'feat/p16-13-scope'   # MERGED_EXACT #191
git -C "$REPO" push origin --delete 'feat/p16-17-turnlog'   # MERGED_EXACT #192
git -C "$REPO" push origin --delete 'feat/p17-01-prodacct'   # MERGED_EXACT #193
git -C "$REPO" push origin --delete 'feat/p17-02-hardening'   # MERGED_EXACT #194
git -C "$REPO" push origin --delete 'feat/p17-03-waf'   # MERGED_EXACT #195
git -C "$REPO" push origin --delete 'feat/p17-04-secrets'   # MERGED_EXACT #196
git -C "$REPO" push origin --delete 'feat/p17-05-backup'   # MERGED_EXACT #197
git -C "$REPO" push origin --delete 'feat/p17-06-drill'   # MERGED_EXACT #198
git -C "$REPO" push origin --delete 'feat/p17-07-scanbase'   # MERGED_EXACT #199
git -C "$REPO" push origin --delete 'feat/p17-08-access'   # MERGED_EXACT #200
git -C "$REPO" push origin --delete 'feat/p17-11-drplan'   # MERGED_EXACT #201
git -C "$REPO" push origin --delete 'feat/p17-12-readiness'   # MERGED_EXACT #202
git -C "$REPO" push origin --delete 'feat/p18-03-provision'   # MERGED_EXACT #203
git -C "$REPO" push origin --delete 'feat/p18-09-killswitch'   # MERGED_EXACT #204
git -C "$REPO" push origin --delete 'feat/p18-10-monitoring'   # MERGED_EXACT #205
git -C "$REPO" push origin --delete 'feat/p18-12-gate'   # MERGED_EXACT #206
git -C "$REPO" push origin --delete 'feat/p20-booking'   # MERGED_EXACT #217
git -C "$REPO" push origin --delete 'feat/p21-handwerk'   # MERGED_EXACT #218
git -C "$REPO" push origin --delete 'feat/p22-team'   # MERGED_EXACT #219
git -C "$REPO" push origin --delete 'feat/p27-email'   # MERGED_EXACT #220
git -C "$REPO" push origin --delete 'feat/p28-timeline'   # MERGED_EXACT #221
git -C "$REPO" push origin --delete 'feat/p29-webhooks'   # MERGED_EXACT #222
git -C "$REPO" push origin --delete 'feat/p30-hardening'   # MERGED_EXACT #223
git -C "$REPO" push origin --delete 'feat/p31-reliability'   # MERGED_EXACT #224
git -C "$REPO" push origin --delete 'feat/p32-validation'   # MERGED_EXACT #225
git -C "$REPO" push origin --delete 'feat/p33-sellgate'   # MERGED_EXACT #226
git -C "$REPO" push origin --delete 'fix/control-plane-worktree-awareness'   # MERGED_EXACT #30
git -C "$REPO" push origin --delete 'fix/p02-06-secret-rule'   # MERGED_EXACT #25
git -C "$REPO" push origin --delete 'fix/qg09-s4-lifecycle'   # MERGED_EXACT #72
git -C "$REPO" push origin --delete 'fix/qg09-s5-rbac'   # MERGED_EXACT #73
git -C "$REPO" push origin --delete 'fix/qg09-s6-invitations'   # MERGED_EXACT #74
git -C "$REPO" push origin --delete 'fix/qg09-s7-recovery'   # MERGED_EXACT #77
git -C "$REPO" push origin --delete 'fix/qg09-s9-grants'   # MERGED_EXACT #71
git -C "$REPO" push origin --delete 'test/p02-05-harness'   # MERGED_PLUS_6 #7
git -C "$REPO" push origin --delete 'test/p06-03-tenant-from-session'   # MERGED_EXACT #49
# git -C "$REPO" push origin --delete 'feat/p09-09-retrieval'   # +1 commit f5b1145 BLOCKER row, not in main
# git -C "$REPO" push origin --delete 'fix/qg09-s2-lock-order'  # +1 commit 934691c EV-P06-079 CI note, not in main

# STEP 9 — FOUNDER ONLY (sudo): root-owned Docker bind-mount leftover, contains only empty directories.
# sudo rm -rf ~/projects/business/moin-sessions

# STEP 10 — optional Docker cleanup of stale moin-server images (~4 GB). Do NOT `docker system prune`:
#           the build cache and volumes are shared with other projects.
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^moin-server:' | xargs -r docker image rm

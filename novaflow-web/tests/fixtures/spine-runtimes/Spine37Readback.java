// Optional integration check with official Maven spine-libgdx:3.7.94.1 and gdx:1.9.9.
// javac -cp "spine-libgdx-3.7.94.1.jar;gdx-1.9.9.jar" Spine37Readback.java
// java -cp ".;spine-libgdx-3.7.94.1.jar;gdx-1.9.9.jar" Spine37Readback exported.json exported.skel
import com.badlogic.gdx.files.FileHandle;
import com.badlogic.gdx.graphics.g2d.TextureRegion;
import com.esotericsoftware.spine.*;
import com.esotericsoftware.spine.attachments.*;

public class Spine37Readback {
  static final AttachmentLoader loader = new AttachmentLoader() {
    public RegionAttachment newRegionAttachment(Skin s, String n, String p) {
      RegionAttachment a = new RegionAttachment(n);
      a.setRegion(new TextureRegion() { public int getRegionWidth() { return 16; } public int getRegionHeight() { return 16; } });
      return a;
    }
    public MeshAttachment newMeshAttachment(Skin s, String n, String p) { return new MeshAttachment(n); }
    public BoundingBoxAttachment newBoundingBoxAttachment(Skin s, String n) { return new BoundingBoxAttachment(n); }
    public ClippingAttachment newClippingAttachment(Skin s, String n) { return new ClippingAttachment(n); }
    public PathAttachment newPathAttachment(Skin s, String n) { return new PathAttachment(n); }
    public PointAttachment newPointAttachment(Skin s, String n) { return new PointAttachment(n); }
  };
  static void check(boolean ok, String label) { if (!ok) throw new AssertionError(label); }
  static void near(float a, float b) { check(Float.isFinite(a) && Float.isFinite(b) && Math.abs(a-b) < 0.02f, a + " vs " + b); }
  public static void main(String[] args) {
    SkeletonData j = new SkeletonJson(loader).readSkeletonData(new FileHandle(args[0]));
    SkeletonData b = new SkeletonBinary(loader).readSkeletonData(new FileHandle(args[1]));
    check("3.7.94".equals(b.getVersion()), "binary version");
    check(j.getBones().size == b.getBones().size, "bone count");
    check(j.getSkins().size == b.getSkins().size, "skin count");
    check(j.getAnimations().size == b.getAnimations().size, "animation count");
    check(j.getEvents().size == b.getEvents().size, "event count");
    int poses = 0;
    for (Skin skin : j.getSkins()) for (Animation anim : j.getAnimations()) {
      Skeleton x = new Skeleton(j), y = new Skeleton(b);
      x.setSkin(skin); y.setSkin(b.findSkin(skin.getName()));
      Animation other = b.findAnimation(anim.getName());
      near(anim.getDuration(), other.getDuration());
      check(anim.getTimelines().size == other.getTimelines().size, "timeline count " + anim.getName() + ": JSON " + anim.getTimelines() + " / binary " + other.getTimelines());
      for (int f = 0; f <= Math.ceil(anim.getDuration() * 30); f++) {
        float t = Math.min(f / 30f, anim.getDuration());
        x.setToSetupPose(); y.setToSetupPose();
        anim.apply(x, -1, t, false, null, 1, Animation.MixBlend.setup, Animation.MixDirection.in);
        other.apply(y, -1, t, false, null, 1, Animation.MixBlend.setup, Animation.MixDirection.in);
        x.updateWorldTransform(); y.updateWorldTransform();
        for (int i = 0; i < x.getBones().size; i++) {
          Bone p = x.getBones().get(i), q = y.getBones().get(i);
          near(p.getWorldX(), q.getWorldX()); near(p.getWorldY(), q.getWorldY());
          near(p.getA(), q.getA()); near(p.getB(), q.getB()); near(p.getC(), q.getC()); near(p.getD(), q.getD());
        }
        for (int i = 0; i < x.getSlots().size; i++) {
          Slot p = x.getSlots().get(i), q = y.getSlots().get(i);
          Attachment pa = p.getAttachment(), qa = q.getAttachment();
          check(pa == null ? qa == null : qa != null && pa.getName().equals(qa.getName()), "attachment");
          near(p.getColor().r, q.getColor().r); near(p.getColor().g, q.getColor().g);
          near(p.getColor().b, q.getColor().b); near(p.getColor().a, q.getColor().a);
          check(p.getAttachmentVertices().size == q.getAttachmentVertices().size, "deform size");
          for (int v = 0; v < p.getAttachmentVertices().size; v++) near(p.getAttachmentVertices().get(v), q.getAttachmentVertices().get(v));
          check(x.getDrawOrder().get(i).getData().getName().equals(y.getDrawOrder().get(i).getData().getName()), "draw order");
        }
        poses++;
      }
    }
    System.out.println("Spine 3.7.94 official JSON/SKEL readback passed: " + poses + " poses");
  }
}

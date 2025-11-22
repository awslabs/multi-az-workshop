namespace BAMCIS.MultiAZApp.Utilities
{
    public interface IEnvironment
    {
        bool Probe();

        Environment GetEnvironmentType();

        string GetInstanceId();

        string GetHostId();

        string GetRegion();

        string GetAZId();

        string GetAZ();

        bool IsOneBox();
    }
}